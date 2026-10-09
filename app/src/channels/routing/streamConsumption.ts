// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 渠道 chatStream 流式消费循环（自 `messageRouter.ts` **内聚抽取**，2026-10-09 C3-S3-S2）。
// 语义逐字不变：空转超时以 `ExecutionAbortedError` 抛出（由调用方的两段式取消 catch 承接）；
// `generator` 的 `done` 分支负责 `finishExecution` 并返回最终结果。

import { getLogger } from '@modules/monitoring';
import { handleError } from '../../error/handleError';
import { formatToolNotifySummary } from './toolNotifySummary';
import { ExecutionAbortedError } from '@modules/execution';
import type { ExecutionManager, ExecutionLease } from '@modules/execution';
import {
  STREAM_IDLE_TIMEOUT_MS,
  LONG_TASK_PLACEHOLDER_AFTER_MS,
} from './messageRouterContract';
import type { ChatStreamChunk } from '@modules/runtime/api/CoreAPI';
import type { MessageContext } from '../types/IChannel';

const logger = getLogger('channels:routing');

export interface ConsumeStreamDeps {
  generator: AsyncGenerator<
    ChatStreamChunk,
    { content: string; finishReason?: string },
    unknown
  >;
  cancelController: AbortController;
  executionManager: ExecutionManager;
  lease: ExecutionLease;
  message: MessageContext;
  channelName: string;
  traceId: string;
  /** 是否启用长任务占位提示与工具进度通知（仅被动回复窗口渠道） */
  enableLongTaskPlaceholder: boolean;
  onOutbound?: (content: string, target: string) => Promise<void>;
  /** 流开始时刻（长任务占位阈值基准） */
  llmStartMs: number;
  /** 终态回调（done 分支：置 COMPLETED/FAILED 并释放 lease） */
  finishExecution: (ok: boolean, reason?: string) => void;
}

export interface ConsumeStreamResult {
  content: string;
  finishReason: string;
}

/**
 * 消费 chatStream 直到 `done`：聚合文本、记账工具调用、按需推送工具/占位通知。
 *
 * 每次等待下一个 chunk 均带独立空转计时器（chunk 到达即重置，活动心跳语义）；
 * 超时 ⇒ `requestCancel` + `abort()` + 抛 `ExecutionAbortedError('INACTIVITY_TIMEOUT')`。
 */
export async function consumeStreamChunks(
  deps: ConsumeStreamDeps
): Promise<ConsumeStreamResult> {
  const {
    generator,
    cancelController,
    executionManager,
    lease,
    message,
    channelName,
    traceId,
    enableLongTaskPlaceholder,
    onOutbound,
    llmStartMs,
    finishExecution,
  } = deps;

  let aggregatedText = '';
  let chunkCount = 0;
  let toolCallChunks = 0;
  let lastToolLogMs = Date.now();
  let streamError: string | undefined;
  let placeholderSent = false;
  // P1-1：首个工具进度通知是否已发送（每任务仅 1 条，QQ seq 配额感知）
  let firstToolNotified = false;
  const outboundTarget = message.conversationId ?? message.senderId;

  for (;;) {
    // 每次等待下一个 chunk 均带独立空转计时器；chunk 到达即重置（活动心跳）
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const idlePromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        // PR2 两段式取消（第一段）：请求取消 + 触发底层 abort（端到端信号）。
        // 状态机 → CANCEL_REQUESTED；确认/保留决策见调用方 catch 分支的 grace 段。
        executionManager.requestCancel(lease.executionId, 'INACTIVITY_TIMEOUT');
        // 以**类型化**中止错误抛出（携带 reason），取代裸 Error + 文案匹配
        const reason = new ExecutionAbortedError(
          'INACTIVITY_TIMEOUT',
          `chatStream 空转超时 (>${STREAM_IDLE_TIMEOUT_MS / 1000}s 无 chunk)`,
          { traceId, messageId: message.messageId }
        );
        // abort 外部信号 → ChatManager 中继到会话 controller → 停止底层执行
        cancelController.abort(reason);
        reject(reason);
      }, STREAM_IDLE_TIMEOUT_MS);
    });
    let result: IteratorResult<
      ChatStreamChunk,
      { content: string; finishReason?: string }
    >;
    try {
      result = await Promise.race([generator.next(), idlePromise]);
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (result.done) {
      // generator return = 最终 ChatResponse（Write-Ahead：done 前已持久化）
      const final = result.value;
      if (streamError) {
        finishExecution(false, streamError);
        return { content: '', finishReason: 'error' };
      }
      finishExecution(true, final.finishReason);
      return {
        content: final.content || aggregatedText,
        finishReason: final.finishReason ?? 'stop',
      };
    }

    const chunk = result.value;
    chunkCount++;
    switch (chunk.type) {
      case 'text':
        aggregatedText += chunk.content ?? '';
        break;
      case 'tool_call':
        toolCallChunks++;
        // PR5-S3（2026-10-09，`.trae/specs/durable-execution.md`）：execution 级**工具调用记账**
        // （`tool_calls` 表）—— Router 既有 `executionId` 又能观测 tool_call chunk，故在此接线；
        // 写穿为 best-effort，未接入 store ⇒ no-op（不阻断流式）。
        {
          const spec = chunk.toolCall;
          if (spec?.id) {
            if (spec.status === 'completed' || spec.status === 'failed') {
              executionManager.settleToolCall(
                lease.executionId,
                spec.id,
                spec.name,
                spec.status,
                spec.error
              );
            } else {
              executionManager.recordToolCall(
                lease.executionId,
                spec.id,
                spec.name
              );
            }
          }
        }
        // 工具活动日志（节流：首个必记，之后每 30s 至多 1 条，防刷屏）
        if (toolCallChunks === 1 || Date.now() - lastToolLogMs > 30_000) {
          lastToolLogMs = Date.now();
          logger.info(`[TRACE] ${traceId} 流式工具活动`, {
            messageId: message.messageId,
            toolCallSeq: toolCallChunks,
            toolName: chunk.toolCall?.name,
            toolStatus: chunk.toolCall?.status,
            chunkCount,
          });
        }
        // P1-1（2026-08-20）：首个工具开始时向渠道推送进度通知，
        // 消除"AI 沉默执行、渠道侧无感知"（根因③）。配额感知设计：
        // 每任务仅 1 条（QQ 同 msg_id 被动回复上限 5 条——
        // 工具通知 seq=1 + 长任务占位 seq=2 + 最终回复 seq=3，安全区内）。
        // 与占位提示共用 enableLongTaskPlaceholder 门控（仅被动回复窗口渠道）。
        // 发送失败不中断主流程。
        if (
          !firstToolNotified &&
          enableLongTaskPlaceholder &&
          chunk.toolCall?.name
        ) {
          firstToolNotified = true;
          try {
            await onOutbound?.(
              `🔧 ${formatToolNotifySummary(chunk.toolCall.name, chunk.toolCall.arguments)}…`,
              outboundTarget
            );
            logger.info(`[TRACE] ${traceId} 工具进度通知已发送`, {
              messageId: message.messageId,
              toolName: chunk.toolCall.name,
              target: outboundTarget,
            });
          } catch (notifyErr) {
            await handleError(notifyErr, {
              module: 'channels:routing',
              action: 'toolProgressNotify',
              context: { traceId, channelName },
            });
          }
        }
        break;
      case 'error':
        streamError = chunk.content || chunk.errorCode || 'stream error';
        logger.warning(`[TRACE] ${traceId} 流式错误 chunk`, {
          messageId: message.messageId,
          errorCode: chunk.errorCode,
          contentPreview: (chunk.content ?? '').slice(0, 120),
        });
        break;
      case 'question':
        // 渠道无法呈现交互 UI（预存缺口）：记录日志，流按既有降级策略继续。
        // 后续如需支持，可在此将 question 转发为渠道文本提问。
        logger.info(
          `[TRACE] ${traceId} 流式出现交互提问（渠道暂不支持 UI 交互）`,
          {
            messageId: message.messageId,
            questionPreview: (chunk.content ?? '').slice(0, 80),
          }
        );
        break;
      default:
        // thinking/status/todo/execution_phase 等：进度类 chunk，渠道不需要逐条处理
        break;
    }

    // AC-5③：长任务占位提示（见 LONG_TASK_PLACEHOLDER_AFTER_MS 注释）。
    // 在被动回复窗口关闭前先送达一条"仍在执行"，避免长任务静默期用户无感知；
    // 仅对声明了被动回复窗口的渠道启用（enableLongTaskPlaceholder，
    // 2026-08-20 渠道对齐：email/sms/webhook 等主动出站渠道不受窗口约束，
    // 占位消息纯属干扰——2 封邮件/收费短信/下游误处理）。
    // 占位发送失败不中断主流程（最终回复仍会尝试出站）。
    if (
      !placeholderSent &&
      enableLongTaskPlaceholder &&
      Date.now() - llmStartMs > LONG_TASK_PLACEHOLDER_AFTER_MS
    ) {
      placeholderSent = true;
      try {
        await onOutbound?.(
          '⏳ 任务仍在执行中，预计还需一些时间，完成后立即回复',
          outboundTarget
        );
        logger.info(`[TRACE] ${traceId} 长任务占位提示已发送`, {
          messageId: message.messageId,
          target: outboundTarget,
          elapsedMs: Date.now() - llmStartMs,
        });
      } catch (placeholderErr) {
        await handleError(placeholderErr, {
          module: 'channels:routing',
          action: 'longTaskPlaceholder',
          context: { traceId, channelName },
        });
      }
    }
  }
}
