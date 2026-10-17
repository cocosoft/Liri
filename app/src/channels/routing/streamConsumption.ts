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

/**
 * U-05（2026-10-17）：把结构化提问渲染为渠道可读文本。
 * `choice/confirm` 列出编号选项；`open` 仅发问题。
 */
function formatQuestionPrompt(
  question: ChatStreamChunk['questionData']
): string {
  if (!question) return '需要你的选择，但本次提问缺少内容。';
  const lines: string[] = [];
  if (question.header?.trim()) lines.push(`【${question.header.trim()}】`);
  lines.push(question.question?.trim() || '需要你的选择');
  if (question.options?.length) {
    lines.push('', '请回复选项编号：');
    question.options.forEach((opt, i) => {
      lines.push(`${i + 1}. ${opt.label}`);
    });
  }
  return lines.join('\n');
}

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
  /** 长任务占位阈值（ms）；缺省用契约常量。测试可注入短阈值。 */
  placeholderAfterMs?: number;
  /**
   * U-05（2026-10-17）：渠道是否支持“回答交互提问”。
   * Stage 1 恒 false ⇒ question 到达时给出明确提示并 fail-closed 中止，避免静默死等。
   */
  supportsQuestionAnswer?: boolean;
  /** U-05b：question 到达且渠道支持回答时登记“下一条消息即答案”。 */
  onQuestionAsked?: (question: ChatStreamChunk['questionData']) => void;
  /** 终态回调（done 分支：置 COMPLETED/FAILED 并释放 lease） */
  finishExecution: (ok: boolean, reason?: string) => void;
}

export interface ConsumeStreamResult {
  content: string;
  finishReason: string;
  /**
   * G-2/C（2026-10-11，Spec `daily-budget-over-limit-ux.md` §5-D-1 C）：流式失败时的**真实业务码**
   * （如 `DAILY_BUDGET_EXCEEDED`）。
   *
   * 原先本层只留下人读文案（`streamError`）并**丢弃** `chunk.errorCode` ⇒ 上层
   * （`messageRouter`）只能按"通用失败"兜底，渠道用户看不到**原因与出路**（当前痛点）。
   */
  errorCode?: string;
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
  const supportsQuestionAnswer = deps.supportsQuestionAnswer === true;

  let aggregatedText = '';
  let chunkCount = 0;
  let toolCallChunks = 0;
  let lastToolLogMs = Date.now();
  let streamError: string | undefined;
  // G-2/C：与 `streamError` 并列保留**机器可读**的真实业务码（供上层透出原因/出路）。
  let streamErrorCode: string | undefined;
  let placeholderSent = false;
  // P1-1：首个工具进度通知是否已发送（每任务仅 1 条，QQ seq 配额感知）
  let firstToolNotified = false;
  const outboundTarget = message.conversationId ?? message.senderId;

  // U-06（2026-10-17）：长任务占位改为**独立定时器**。
  // 原判定在 chunk 消费循环体内：静默期（无 chunk）循环阻塞在 generator.next()，
  // 4 分钟阈值永远不会被检查。定时器与流读取解耦后，静默期也能按时提醒。
  const placeholderAfterMs =
    deps.placeholderAfterMs ?? LONG_TASK_PLACEHOLDER_AFTER_MS;
  let placeholderPromise: Promise<void> | undefined;
  const sendPlaceholder = (): void => {
    if (placeholderSent || !enableLongTaskPlaceholder || !onOutbound) return;
    placeholderSent = true;
    placeholderPromise = onOutbound(
      '⏳ 任务仍在执行中，预计还需一些时间，完成后立即回复',
      outboundTarget
    )
      .then(() => {
        logger.info(`[TRACE] ${traceId} 长任务占位提示已发送`, {
          messageId: message.messageId,
          target: outboundTarget,
          elapsedMs: Date.now() - llmStartMs,
        });
      })
      .catch((placeholderErr) => {
        void handleError(placeholderErr, {
          module: 'channels:routing',
          action: 'longTaskPlaceholder',
          context: { traceId, channelName },
        });
      });
  };
  const placeholderTimer = setTimeout(
    sendPlaceholder,
    Math.max(0, llmStartMs + placeholderAfterMs - Date.now())
  );

  try {
    for (;;) {
      // 每次等待下一个 chunk 均带独立空转计时器；chunk 到达即重置（活动心跳）
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const idlePromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          // PR2 两段式取消（第一段）：请求取消 + 触发底层 abort（端到端信号）。
          // 状态机 → CANCEL_REQUESTED；确认/保留决策见调用方 catch 分支的 grace 段。
          executionManager.requestCancel(
            lease.executionId,
            'INACTIVITY_TIMEOUT'
          );
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
          return {
            content: '',
            finishReason: 'error',
            // G-2/C：把真实业务码透出（无码则不带该字段，由上层按通用失败兜底）
            ...(streamErrorCode ? { errorCode: streamErrorCode } : {}),
          };
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
          // B-05（2026-10-09，第九轮审查专项 B §十五）：工具调用记账（`tool_calls` 表）**已移交
          // 工具执行者**（`ChatManager.executeTool` 的 `beginToolCall`（前置，失败即**拒绝该工具**）
          // + `settleToolCall`（后置））。
          //
          // 为什么迁移：本层是流式**观察者**（先有 chunk 才有机会记账），**无法保证**"落盘先于
          // 工具副作用"，也无法精确拒绝**单个**工具。原 PR5-S3 在此处接线属权宜（当时
          // `executionId` 只由 Router 侧产生）；B-05 已把 `executionId` 下传到执行者
          // （`ChatRequest` → `StreamMessageOptions` → `ChatManager` 按会话登记）⇒ **单一写入方**。
          // 本层仅保留工具活动日志与进度通知。
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
          // G-2/C：保留真实业务码（人读文案仅作 `finishExecution` 的 reason / 日志）
          streamErrorCode = chunk.errorCode;
          logger.warning(`[TRACE] ${traceId} 流式错误 chunk`, {
            messageId: message.messageId,
            errorCode: chunk.errorCode,
            contentPreview: (chunk.content ?? '').slice(0, 120),
          });
          break;
        case 'question': {
          // U-05 Stage 1（2026-10-17）：先如实把问题发给用户。
          // 渠道无回答能力时 **fail-closed 中止**（而不是只记日志让后端挂起到超时）。
          const prompt = formatQuestionPrompt(chunk.questionData);
          try {
            await onOutbound?.(prompt, outboundTarget);
          } catch (questionNotifyErr) {
            await handleError(questionNotifyErr, {
              module: 'channels:routing',
              action: 'questionNotify',
              context: { traceId, channelName },
            });
          }
          if (!supportsQuestionAnswer) {
            const reason =
              '当前渠道不支持交互回答，请在桌面端/网页端继续该会话。';
            try {
              await onOutbound?.(reason, outboundTarget);
            } catch {
              // @ignore-catch — 提示失败不改变 fail-closed 结论
            }
            const unsupported = new ExecutionAbortedError(
              'CHANNEL_INTERACTION_UNSUPPORTED',
              '渠道收到交互提问但无回答能力，已中止以避免静默挂起',
              {
                traceId,
                messageId: message.messageId,
                questionId: chunk.questionData?.questionId,
                channelName,
              }
            );
            executionManager.requestCancel(
              lease.executionId,
              'CHANNEL_INTERACTION_UNSUPPORTED'
            );
            cancelController.abort(unsupported);
            throw unsupported;
          }
          // U-05b：登记待答问题；下一入站消息由 messageRouter 作为答案消费。
          deps.onQuestionAsked?.(chunk.questionData);
          break;
        }
        default:
          // thinking/status/todo/execution_phase 等：进度类 chunk，渠道不需要逐条处理
          break;
      }
    }
  } finally {
    // U-06：流结束即撤销定时器；若占位已触发，先等它完成再返回，
    // 保证「占位 → 最终回复」的发送顺序不倒挂。
    clearTimeout(placeholderTimer);
    await placeholderPromise;
  }
}
