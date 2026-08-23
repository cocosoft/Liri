/**
 * ChatManagerTAORAdapter — ChatManager → TAORLoop 适配器
 *
 * 批次 4：将 ChatManager 的能力封装为 TAORLoopDeps 接口，
 * 使 TAORLoop 可以编排 ChatManager 的工具调用循环。
 *
 * 通过 ENABLE_LOOP_V8_PHASE2 环境变量灰度切换。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { ToolCall, ToolResult } from '../chat/types/tool.js';
import type { ChatMessage, ToolDefinition } from '../ai/models/types';
import type { TAORLoopDeps } from './TAORLoop.js';
import { createTAORLoopDeps } from './TAORLoop.js';
import { CascadeAbortManager } from './CascadeAbortManager.js';
import type { ToolCallEventDetail } from '../chat/types/message.js';
import type {
  QuestionData,
  QuestionOption,
} from '@modules/runtime/api/CoreAPI.js';

const logger = getLogger('query:chatManagerTAORAdapter');

/**
 * 安全序列化（第三轮复查，对齐 ReActToolLoop 遗漏 3）：
 * ToolResult.result 类型为 unknown，工具可返回任意结构；循环引用/BigInt 会抛
 * TypeError → 被 executeTools 的 catch 误报"工具失败"并可能触发级联中止。
 * 失败降级为空串（SlowOperationDetector.safeStringify 为异步慢操作检测语义，不适用）。
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch (err) {
    // 序列化失败（循环引用/BigInt 等异常结构）：降级空串，记录来源便于排查
    logger.warn('taorAdapter:safeStringify failed', {
      error: String(err),
      valueType: typeof value,
    });
    return '';
  }
}

// ─── ChatManager 暴露给适配器的能力接口 ────────────────

export interface ChatManagerTAORContext {
  /** 非流式 LLM 调用（sendMessage 路径） */
  sendModelRequest: (
    messages: ChatMessage[],
    options?: Record<string, unknown>
  ) => Promise<{
    content: string;
    tool_calls?: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  }>;

  /** 单个工具执行 */
  executeTool: (
    toolCall: ToolCall,
    opts?: { useErrorHandler?: boolean }
  ) => Promise<ToolResult>;

  /** 消息持久化 */
  persistMessage: (
    sessionId: string,
    content: string,
    role: string,
    toolCallId?: string,
    metadata?: Record<string, unknown>
  ) => void;

  /** 会话 ID */
  sessionId: string;

  /** 工具定义列表 */
  toolDefinitions: ToolDefinition[];

  /** 工具注册表（用于交互检查，v0.5 新增） */
  toolRegistry?: {
    getTool(name: string):
      | {
          requiresUserInteraction?: () => boolean;
        }
      | undefined;
  };

  /** 待处理交互 Map（v0.5 新增：requiresUserInteraction 工具等待用户答案） */
  pendingInteractions?: Map<
    string,
    {
      questionId: string;
      promise: Promise<string[]>;
      resolve: (answers: string[]) => void;
    }
  >;

  /** 进度通知回调 */
  onProgress?: (progress: {
    stage: string;
    message: string;
    toolName?: string;
  }) => void;
  /** 工具执行回调 */
  onToolCall?: (
    event: string,
    toolName: string,
    toolCallId: string,
    detail?: ToolCallEventDetail
  ) => void;
  /** 用量回调 */
  onUsage?: (usage: Record<string, unknown>) => void;
  /** 流式 chunk 透传（streamMessage 路径使用） */
  onStreamChunk?: (chunk: unknown) => void;
  /**
   * 事件写入通道（可选，B-2 补发）：TAOR 守卫拦截时补发 tool/canceled 终态用。
   * 由 ChatManager._buildTAORContext 绑定 this.appendStreamEvent。
   */
  appendStreamEvent?: (
    sessionId: string,
    event: {
      type: string;
      seq: number;
      time: number;
      sessionId: string;
      data: Record<string, unknown>;
    }
  ) => Promise<{ ok: boolean }>;
  /** 当前会话事件尾号（可选）：补发 tool/canceled 时分配 seq 用 */
  getStreamTailSeq?: (sessionId: string) => Promise<number>;
  /** 等待待处理落盘完成（可选）：补发前确保 tool_call 事件已写入 */
  flushPendingPersists?: () => Promise<void>;
}

// ─── 工厂函数 ──────────────────────────────────────────

/**
 * 基于 ChatManager 上下文创建 TAORLoopDeps
 *
 * 封装 ChatManager 的 LLM 调用、工具执行、消息持久化能力，
 * 提供给 TAORLoop.run() 使用。
 */
export function createChatManagerTAORDeps(
  ctx: ChatManagerTAORContext
): TAORLoopDeps {
  // P1-5: 级联中止管理器 — Bash/写操作错误 → 中止本轮所有兄弟工具
  const cascadeManager = new CascadeAbortManager();

  // P0-2 修复（2026-08-20 渠道排查）：persistMessages 原实现全量无差别 append，
  // TAOR 每轮把整个 messages 数组（含全部历史）重新持久化 → 会话文件重复膨胀
  // （33 行中 18 行重复）、上下文 token 同步膨胀。改为内容指纹判重，只持久化新消息。
  const persistedFingerprints = new Set<string>();
  const fingerprintOf = (msg: ChatMessage): string => {
    const toolCallId = (msg as { tool_call_id?: string }).tool_call_id ?? '';
    const toolCallsKey = msg.tool_calls ? JSON.stringify(msg.tool_calls) : '';
    return `${msg.role}|${toolCallId}|${toolCallsKey}|${
      typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content)
    }`;
  };

  return createTAORLoopDeps({
    // ── callModel：将非流式 LLM 调用包装为 AsyncGenerator ──
    callModel: async function* (messages: ChatMessage[], _signal: AbortSignal) {
      try {
        const response = await ctx.sendModelRequest(messages, {
          tools:
            ctx.toolDefinitions.length > 0 ? ctx.toolDefinitions : undefined,
        });

        yield {
          type: 'text',
          content: response.content ?? '',
          tool_calls: (response.tool_calls ?? []).map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          })),
          usage: response.usage,
        };
        yield { type: 'done' };
      } catch (error) {
        await handleError(error, {
          module: 'query:taorAdapter',
          action: 'callModel',
        });
        throw error;
      }
    },

    // ── executeTools：逐个执行工具调用 ──
    executeTools: async (
      toolCalls: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }>,
      taorSignal: AbortSignal
    ) => {
      const results: Array<{
        toolCallId?: string;
        toolName?: string;
        result?: unknown;
        error?: string;
      }> = [];

      // P1-5: 级联中止 — 启动新一轮，创建 cascade controller
      const cascadeController = cascadeManager.startRound();
      // 合并 TAORLoop 和 cascade 两个 signal
      const combinedSignal = AbortSignal.any([
        taorSignal,
        cascadeController.signal,
      ]);

      // P1-5: 遍历前检查是否已被中止
      if (combinedSignal.aborted) {
        logger.warn('TAOR executeTools 启动前已被中止，跳过全部工具', {
          sessionId: ctx.sessionId,
          toolCount: toolCalls.length,
          toolNames: toolCalls.map((tc) => tc.name),
        });
        for (const tc of toolCalls) {
          results.push({
            toolCallId: tc.id,
            toolName: tc.name,
            error: 'Aborted: cascade abort triggered by sibling tool failure',
          });
        }
        return results;
      }

      const onAbort = new Promise<never>((_, reject) => {
        const handler = () => {
          reject(new DOMException('Aborted by cascade abort', 'AbortError'));
        };
        if (combinedSignal.aborted) {
          handler();
        } else {
          combinedSignal.addEventListener('abort', handler, { once: true });
        }
      });

      for (const tc of toolCalls) {
        // P1-5: 每个工具启动前检查中止信号
        if (combinedSignal.aborted) {
          logger.warn('TAOR 工具因级联中止被跳过', {
            sessionId: ctx.sessionId,
            toolName: tc.name,
            toolCallId: tc.id,
          });
          results.push({
            toolCallId: tc.id,
            toolName: tc.name,
            error: 'Skipped: cascade abort triggered',
          });
          continue;
        }

        const toolStartMs = Date.now();
        const argsPreview = (() => {
          try {
            const s = JSON.stringify(tc.arguments ?? {});
            return s.length > 120 ? `${s.slice(0, 120)}…` : s;
          } catch {
            return '[unserializable]';
          }
        })();
        logger.info('TAOR 工具执行开始', {
          sessionId: ctx.sessionId,
          toolName: tc.name,
          toolCallId: tc.id,
          argsPreview,
        });

        // v0.5: requiresUserInteraction 检测（对齐 ReActToolLoop act 遗漏 2）
        // 非流式路径：检测到交互工具时，发送 question chunk 并等待用户答案
        const toolObj = ctx.toolRegistry?.getTool(tc.name);
        if (toolObj?.requiresUserInteraction?.()) {
          // 同轮多提问防护（对齐 ReActToolLoop）：Map 单槽不静默覆盖
          if (ctx.pendingInteractions?.has(ctx.sessionId)) {
            logger.warn('taorAdapter:interaction_already_pending', {
              sessionId: ctx.sessionId,
              toolName: tc.name,
              toolCallId: tc.id,
            });
            results.push({
              toolCallId: tc.id,
              toolName: tc.name,
              error: '已有待处理交互，本次提问被拒绝',
            });
            continue;
          }

          const args = tc.arguments as Record<string, unknown>;
          const questionId = `q_${Date.now()}_${(tc.id || '').slice(0, 8)}`;
          const questionData: QuestionData = {
            questionId,
            question: String(args.question ?? ''),
            header: String(args.header ?? '用户确认'),
            options: (args.options as QuestionOption[]) ?? [],
            multiSelect: args.multiSelect === true,
            questionType:
              (args.questionType as QuestionData['questionType']) ?? 'choice',
          };

          // 注册 pendingInteraction
          let resolveAnswers!: (answers: string[]) => void;
          const answerPromise = new Promise<string[]>((res) => {
            resolveAnswers = res;
          });
          ctx.pendingInteractions?.set(ctx.sessionId, {
            questionId,
            promise: answerPromise,
            resolve: resolveAnswers,
          });

          // 发送 question chunk（通过 onStreamChunk 透传给前端）
          logger.info('taorAdapter:interaction_question_emitted', {
            sessionId: ctx.sessionId,
            toolCallId: tc.id,
            toolName: tc.name,
            questionId,
          });
          ctx.onStreamChunk?.({
            type: 'question',
            content: questionData.question,
            sessionId: ctx.sessionId,
            questionData,
          });

          // 等待用户答案（带超时兜底，默认 5 分钟）
          const INTERACTION_TIMEOUT_MS = 5 * 60 * 1000;
          const timeoutPromise = new Promise<'timeout'>((res) =>
            setTimeout(res, INTERACTION_TIMEOUT_MS, 'timeout' as const)
          );
          const abortPromise = new Promise<'abort'>((res) => {
            if (combinedSignal.aborted) {
              res('abort');
              return;
            }
            combinedSignal.addEventListener('abort', () => res('abort'), {
              once: true,
            });
          });

          const winner = await Promise.race([
            answerPromise.then((a) => ({ kind: 'answer' as const, value: a })),
            timeoutPromise.then((v) => ({ kind: v as 'timeout' })),
            abortPromise.then((v) => ({ kind: v as 'abort' })),
          ]);

          ctx.pendingInteractions?.delete(ctx.sessionId);

          if (winner.kind === 'answer') {
            // 注入用户答案到工具参数
            (tc.arguments as Record<string, unknown>)._userAnswers =
              winner.value;
            logger.info('taorAdapter:interaction_resolved', {
              sessionId: ctx.sessionId,
              questionId,
              answerCount: winner.value.length,
            });
          } else {
            // 超时或中止：跳过工具执行
            const reason = winner.kind === 'timeout' ? '超时' : '中止';
            logger.warn('taorAdapter:interaction_failed', {
              sessionId: ctx.sessionId,
              questionId,
              reason,
            });
            results.push({
              toolCallId: tc.id,
              toolName: tc.name,
              error: `用户交互${reason}，工具未执行`,
            });
            ctx.onToolCall?.('end', tc.name, tc.id, {
              ok: false,
              message: `用户交互${reason}`,
            });
            continue;
          }
        }

        ctx.onProgress?.({
          stage: 'tool_executing',
          message: `正在执行 ${tc.name}...`,
          toolName: tc.name,
        });

        logger.debug('taorAdapter:onToolCall start', {
          toolName: tc.name,
          toolCallId: tc.id,
          onToolCallRegistered: !!ctx.onToolCall,
        });
        ctx.onToolCall?.('start', tc.name, tc.id, { args: tc.arguments });

        try {
          // P1-5: Promise.race 使工具执行可被 AbortSignal 中断
          // P3-12: coerce_tool_args 类型强制由 ToolExecutor.execute() 统一处理，TAORLoop 路径通过 executeTool 委托 ToolManager 间接覆盖
          const executePromise = ctx.executeTool(
            {
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
              sessionId: ctx.sessionId,
            },
            { useErrorHandler: true }
          );

          const toolResult = await Promise.race([executePromise, onAbort]);

          // P1-5: 报告结果给 CascadeAbortManager — Bash/写错误触发级联中止
          const hasError = !!toolResult.error;
          cascadeManager.reportResult(tc.name, !hasError, toolResult.error);

          // 审批等待态判定（对齐 ReActToolLoop 遗漏 2）：审批等待工具返回
          // { result: { pendingApproval: true } }（error 为 undefined），不触发
          // onToolCall('end')——否则 CoreAPIImpl 误发 "✅ Tool completed"、前端
          // 聚合把审批中工具计入 completed++（显示 "2/3 完成"），与 pendingApproval 徽标矛盾。
          const isPendingApproval =
            (toolResult as { result?: { pendingApproval?: boolean } })?.result
              ?.pendingApproval === true;

          const resultDetail: ToolCallEventDetail = toolResult.error
            ? {
                ok: false,
                message: `失败: ${toolResult.error.slice(0, 200)}`,
              }
            : {
                ok: true,
                message: `成功: ${safeStringify(toolResult.result).slice(0, 200)}`,
                result: toolResult.result,
              };

          logger.debug('taorAdapter:onToolCall end', {
            toolName: tc.name,
            toolCallId: tc.id,
            status: toolResult.error ? 'failed' : 'success',
            message: resultDetail.message,
            pendingApproval: isPendingApproval,
            onToolCallRegistered: !!ctx.onToolCall,
          });
          if (!isPendingApproval) {
            ctx.onToolCall?.('end', tc.name, tc.id, resultDetail);
          }

          results.push({
            toolCallId: tc.id,
            toolName: tc.name,
            result: toolResult.result,
            error: toolResult.error,
          });
          logger.info('TAOR 工具执行完成', {
            sessionId: ctx.sessionId,
            toolName: tc.name,
            toolCallId: tc.id,
            durationMs: Date.now() - toolStartMs,
            ok: !toolResult.error,
            error: toolResult.error
              ? String(toolResult.error).slice(0, 200)
              : undefined,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);

          logger.error('TAOR 工具执行异常', {
            sessionId: ctx.sessionId,
            toolName: tc.name,
            toolCallId: tc.id,
            durationMs: Date.now() - toolStartMs,
            error: errMsg.slice(0, 300),
          });
          // P1-5: 异常也报告给 CascadeAbortManager
          if (err instanceof DOMException && err.name === 'AbortError') {
            // 已被 cascade 中止，不需要再次报告
          } else {
            cascadeManager.reportResult(tc.name, false, errMsg);
          }
          ctx.onToolCall?.('end', tc.name, tc.id, {
            ok: false,
            message: `错误: ${errMsg.slice(0, 200)}`,
          });
          results.push({
            toolCallId: tc.id,
            toolName: tc.name,
            error: errMsg,
          });
        }
      }

      return results;
    },

    // ── persistMessages：持久化消息（增量判重，见函数头 P0-2 说明） ──
    persistMessages: async (messages: ChatMessage[]) => {
      let skipped = 0;
      let persisted = 0;
      for (const msg of messages) {
        const fp = fingerprintOf(msg);
        if (persistedFingerprints.has(fp)) {
          skipped++;
          continue;
        }
        if (msg.role === 'assistant' && msg.content) {
          ctx.persistMessage(
            ctx.sessionId,
            msg.content as string,
            'assistant',
            undefined,
            {
              tool_calls: msg.tool_calls,
            }
          );
          persistedFingerprints.add(fp);
          persisted++;
        } else if (msg.role === 'tool') {
          ctx.persistMessage(
            ctx.sessionId,
            msg.content as string,
            'tool',
            (msg as { tool_call_id?: string }).tool_call_id
          );
          persistedFingerprints.add(fp);
          persisted++;
        }
      }
      if (persisted > 0 || skipped > 0) {
        logger.info('TAOR persistMessages 增量持久化完成', {
          sessionId: ctx.sessionId,
          total: messages.length,
          persisted,
          skippedDuplicate: skipped,
        });
      }
    },

    // ── onStreamChunk：流式透传 ──
    onStreamChunk: (chunk: unknown) => {
      ctx.onStreamChunk?.(chunk);
    },

    // ── 事件写入通道（B-2 补发）：守卫拦截 tool/canceled 补发透传 ──
    appendStreamEvent: ctx.appendStreamEvent
      ? (sessionId, event) => ctx.appendStreamEvent!(sessionId, event)
      : undefined,
    getStreamTailSeq: ctx.getStreamTailSeq
      ? (sessionId) => ctx.getStreamTailSeq!(sessionId)
      : undefined,
    flushPendingPersists: ctx.flushPendingPersists
      ? () => ctx.flushPendingPersists!()
      : undefined,

    // ── needsFollowUp：检查是否有待执行工具调用 ──
    needsFollowUp: (response: unknown) => {
      const r = response as { tool_calls?: Array<unknown> } | undefined;
      return !!(r?.tool_calls && r.tool_calls.length > 0);
    },
  });
}
