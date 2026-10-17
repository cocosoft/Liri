// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ChatStreamResume —— 断点续跑（`resumeStream`）外移模块（ChatManager 拆分批 U-22/S4）
 *
 * **来源**：从 `ChatManager.ts` 外移 `resumeStream`（289 行）。
 *
 * **职责（单一：一次「从持久化状态继续跑工具轮」的完整流程）**：
 *   ① 会话互斥（acquire → 最外层 finally 唯一 release）
 *   ② 状态恢复（PAUSED → ACTIVE）+ 自动检查点恢复（无则从 events.jsonl 尾部重建）
 *   ③ 重建剩余工具调用 → 交给统一 ReActToolLoop（`createChatAgentLoop`）执行
 *   ④ 收尾落盘 assistant 消息
 *
 * **行为等价**：日志文案、异常语义、yield 顺序与 `finally` 释放点**逐字未变**
 * （仅把 `this.` 换成注入的 deps）。E2E-1 的「锁释放在最外层」根因修复原样保留。
 */

import type { ParsedToolCall, ToolAwareClient, ToolDefinition } from '@modules/ai';
import { estimateMessagesTokens } from '@modules/ai';
import { SimpleMutex } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import type { LoopDetector } from '@modules/query';
import type { ChatStreamChunk } from '@modules/runtime/api/CoreAPI.js';
import type { Message } from '@modules/session/types/message.js';
import type { ChatSession } from '@modules/session/types/session.js';
import type { ToolCall, ToolResult } from '@modules/session/types/tool.js';
import type { UnifiedTokenTracker } from '@modules/tokenBudget';
import type { ToolRegistry, ToolSchema } from '@modules/tools';

import { StreamingAutoCheckpoint } from '../services/StreamingAutoCheckpoint';
import { stripThinkResponseTags } from '../services/MessageContextPipeline';
import { repairImageUrls } from '../services/ChatHelper';
import { stripBareExploration } from '../services/bareExplorationStripper';
import type { MessageService } from '../services/MessageService.js';
import type { PendingInteractionEntry } from './rollback';

const logger = getLogger('chat:manager');

/** `_toolExecutionService.executeTool` 的透传选项（进度链路） */
export interface ResumeExecuteToolOptions {
  useErrorHandler?: boolean;
  onProgress?: (progress: {
    toolUseID: string;
    data: Record<string, unknown>;
  }) => void;
}

export interface StreamResumeDeps {
  /** 会话互斥锁（与宿主共享同一 Map） */
  sessionMutexes: Map<string, SimpleMutex>;
  /** 恢复会话状态（PAUSED → ACTIVE） */
  resumeSessionState: (sessionId: string) => Promise<void>;
  /** 检查点服务（装配 `StreamingAutoCheckpoint`） */
  checkpointService: ConstructorParameters<typeof StreamingAutoCheckpoint>[0];
  /** 无自动检查点时从事件日志尾部重建未完成 turn */
  rebuildTrailingTurnFromEvents: (
    sessionId: string
  ) => Promise<Awaited<ReturnType<StreamingAutoCheckpoint['restore']>>>;
  /** 取或加载会话 */
  getOrLoadSession: (sessionId: string) => Promise<ChatSession>;
  /** 会话级中止控制器（与宿主共享同一 Map） */
  sessionAbortControllers: Map<string, AbortController>;
  /** 取当前 LLM 客户端 */
  getLLMClient: () => ToolAwareClient;
  /** 当前工具 schema 清单（无注册表 ⇒ null） */
  getToolSchemas: () => ToolSchema[] | null;
  /** `ToolSchema[] → ToolDefinition[]` */
  buildToolDefinitions: (schemas: ToolSchema[]) => ToolDefinition[];
  /** 本轮工具清单落事件（引用式去重） */
  recordToolsSnapshot: (sessionId: string, schemas: ToolSchema[]) => void;
  /** 基础工具轮上限（恢复场景会按剩余工具数动态放宽） */
  maxToolTurns: number;
  /** 工具执行（宿主唯一入口） */
  executeTool: (
    toolCall: ToolCall,
    opts?: ResumeExecuteToolOptions
  ) => Promise<ToolResult>;
  /** 待处理交互（与宿主共享同一 Map） */
  pendingInteractions: Map<string, PendingInteractionEntry>;
  /** 循环检测器（与宿主共享同一实例） */
  loopDetector: LoopDetector;
  /** 消息服务 */
  messageService: MessageService;
  /** 消息落盘（宿主 `_addAndPersistMessage`） */
  addAndPersistMessage: (sessionId: string, message: Message) => Promise<void>;
  /** Token 追踪器（流式水位） */
  unifiedTracker: UnifiedTokenTracker;
  /** 用量记账（宿主唯一入口） */
  recordChatResponseUsage: (
    sessionId: string,
    usage: Record<string, number>,
    requestId?: number,
    model?: string
  ) => void;
  /** 当前工具注册表（可能为 null） */
  getToolRegistry: () => ToolRegistry | null;
  /** 工具轮下一轮请求消息构建 */
  buildToolRoundMessages: (
    currentMessages: Record<string, unknown>[],
    currentAssistantMsg: Message,
    currentToolCalls: ParsedToolCall[],
    processedResults: Array<{
      normalizedToolCall: ToolCall;
      result: ToolResult;
    }>
  ) => Record<string, unknown>[];
}

export class ChatStreamResume {
  constructor(private readonly deps: StreamResumeDeps) {}

  async *resume(
    sessionId: string,
    checkpointId: string
  ): AsyncGenerator<string | ChatStreamChunk, Message, unknown> {
    const deps = this.deps;

    // P2-1: 获取会话互斥锁，防止并发恢复请求操作同一会话
    let mutex = deps.sessionMutexes.get(sessionId);
    if (!mutex) {
      mutex = new SimpleMutex();
      deps.sessionMutexes.set(sessionId, mutex);
    }
    await mutex.acquire();

    // E2E-1 根因修复（2026-10-12）：**互斥锁的释放必须覆盖 `acquire` 之后的全部出口**。
    // 修复前本方法只有工具循环那一段的 `try/finally` 在 release，而其**之前**的两个执行出口
    // —— `StreamingAutoCheckpoint.restore()` 抛错、以及「无可用检查点 ⇒ yield error + return」
    // ——都落在该 `finally` **之外** ⇒ 锁永久泄漏。（`resumeSession` 那段自带 try/catch，
    // 不构成第三个出口。）
    // 后果（真实 E2E 实证）：`getHeldDurationMs() > 0` 使该会话被 `ChatOrchestrator.sendMessage`
    // 的在飞守卫（`上一条回复仍在生成中…`，`ChatOrchestrator.ts:681-686`）**永久**判为"生成中"：
    // 预算挂起唤醒的「重发一轮」被挡下（`resumeSuspendedSession: 流式重发失败`），再次唤醒则
    // `SimpleMutex: acquire timeout after 30000ms`。故把 `try` 前移到 `acquire` 之后，
    // **release 仍只有最外层这一处**（唯一释放点，避免双重 release 清零他人持有的锁）。
    try {
      // 中断治理（2026-08-15）：resume 时同步恢复会话状态（PAUSED → ACTIVE），
      // 避免崩溃恢复标记的 paused 会话在磁盘上永久冻结；失败不阻断检查点恢复主流程
      try {
        await deps.resumeSessionState(sessionId);
      } catch (e) {
        // @ignore-catch — 状态恢复失败不影响检查点恢复
        logger.warn('resume 时恢复会话状态失败', {
          sessionId,
          error: String(e),
        });
      }

      const streamingCheckpoint = new StreamingAutoCheckpoint(
        deps.checkpointService,
        sessionId
      );

      let restoreResult: Awaited<
        ReturnType<StreamingAutoCheckpoint['restore']>
      >;
      try {
        restoreResult = await streamingCheckpoint.restore();
      } catch (err) {
        // BUG-1 修复：此处不再 release（由最外层 finally 统一释放一次，
        // 避免双重 release 清零他人持有的锁）。
        throw err;
      }
      if (!restoreResult) {
        // M2-T2.1（2026-08-31）：无自动检查点 → 从 events.jsonl 尾部重建未完成 turn。
        // 对齐 openworker _unanswered_trailing_tool_calls：重启/引擎不可用后，
        // 已答工具（有 result/canceled 终态）跳过、未答工具重放，不重复执行。
        restoreResult = await deps.rebuildTrailingTurnFromEvents(sessionId);
      }
      if (!restoreResult) {
        yield {
          type: 'error',
          content: '无可用检查点，无法恢复',
          sessionId,
        } as ChatStreamChunk;
        return null as unknown as Message;
      }

      const { checkpoint, stepIndex, completedToolCallIds, generatorState } =
        restoreResult;

      // BUG-A2 修复（2026-08-26）：恢复后同步检查点节奏——新实例 stepIndex=0
      // 会导致恢复后的全量/delta 检查点时间错位
      streamingCheckpoint.restoreStepIndex(stepIndex);

      // 1. 恢复会话状态
      const session = await deps.getOrLoadSession(sessionId);
      session.messages = checkpoint.messages;

      // 2. 创建新的 streamAbortController
      const streamAbortController = new AbortController();
      deps.sessionAbortControllers.set(sessionId, streamAbortController);

      // 3. 找到最后一条含 tool_calls 的 assistant 消息，提取剩余工具
      let accumulatedContent = '';
      let remainingToolCalls: ParsedToolCall[] = [];
      for (let i = session.messages.length - 1; i >= 0; i--) {
        const msg = session.messages[i];
        if (msg.role === 'assistant' && msg.metadata?.tool_calls) {
          const tcs = msg.metadata.tool_calls as Array<{
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }>;
          remainingToolCalls = tcs
            .filter((tc) => !completedToolCallIds.includes(tc.id))
            .map((tc) => ({
              id: tc.id,
              name: tc.function.name,
              arguments:
                typeof tc.function.arguments === 'string'
                  ? JSON.parse(tc.function.arguments)
                  : tc.function.arguments,
            }));
          accumulatedContent =
            typeof msg.content === 'string' ? msg.content : '';
          break;
        }
      }

      if (remainingToolCalls.length === 0) {
        logger.info('resumeStream: 所有工具已完成，无需恢复', { sessionId });
        // BUG-1 修复：此处不再 release（由最外层 finally 统一释放一次）
        yield {
          type: 'status',
          statusType: 'task_all_done',
          content: '任务已全部完成',
          sessionId,
        } as ChatStreamChunk;
        return session.messages[session.messages.length - 1] || ({} as Message);
      }

      // 4. 获取工具定义
      const activeClient = deps.getLLMClient();
      const toolSchemas = deps.getToolSchemas();
      const toolDefinitions: ToolDefinition[] = toolSchemas
        ? deps.buildToolDefinitions(toolSchemas)
        : [];
      // TR-12-B（2026-09-22）：本轮工具清单落事件（引用式去重）——§1.6 红线
      if (toolSchemas && toolDefinitions.length > 0) {
        deps.recordToolsSnapshot(sessionId, toolSchemas);
      }

      logger.info('resumeStream: 开始恢复执行', {
        sessionId,
        stepIndex,
        completedToolCount: completedToolCallIds.length,
        remainingToolCount: remainingToolCalls.length,
        toolTurnCount: generatorState.toolTurnCount,
      });

      yield {
        type: 'status',
        statusType: 'resume',
        content: `从第 ${stepIndex} 步恢复 — 剩余 ${remainingToolCalls.length} 个工具`,
        sessionId,
      } as ChatStreamChunk;

      // 断线恢复动态上限（2026-09-01）：剩余工具数决定所需轮次，避免恢复的
      // 长任务在基础阈值（30 轮）内被误杀。历史轮次 + 剩余工具 + 5 轮余量。
      const toolTurnCount = generatorState.toolTurnCount;
      const MAX_TOOL_TURNS = Math.max(
        deps.maxToolTurns,
        toolTurnCount + remainingToolCalls.length + 5
      );

      // 5. 工具执行循环（轻量模式收敛 2026-09-01：复用 ReActToolLoop，经统一工厂。
      //    对齐 ReActToolLoop.reason 首轮"直接执行剩余工具"语义（needsInitialLlmCall=false），
      //    消除手写循环（原三轨之一）。恢复场景简化语义保持：不启用审批/心跳。
      const apiMessages = session.messages.map((m) => ({
        role: m.role,
        content:
          typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        ...(m.metadata?.tool_calls
          ? { tool_calls: m.metadata.tool_calls }
          : {}),
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      }));

      const { toolResultRegistry } = await import(
        '../../tool/ToolResultRegistry.js'
      );
      const toolLoopCtx = {
        session,
        options: {},
        abortSignal: streamAbortController.signal,
        executeTool: (tc: ParsedToolCall, opts: unknown) =>
          deps.executeTool(
            { id: tc.id, name: tc.name, arguments: tc.arguments, sessionId },
            opts as ResumeExecuteToolOptions
          ),
        pendingInteractions: deps.pendingInteractions,
        loopDetector: deps.loopDetector,
        messageService: deps.messageService,
        addAndPersistMessage: (sid: string, msg: Message) =>
          deps.addAndPersistMessage(sid, msg),
        checkpointService: deps.checkpointService,
        // Task 5 Fix round 1：端口装配已**收敛到 `buildToolLoopContext` 内**（含必填 `suspend`）⇒
        // 此处传裸检查点；「恢复路径漏接 suspend ⇒ 幽灵挂起」由该收敛点统一兜住。
        streamingCheckpoint,
        activeClient,
        unifiedTracker: deps.unifiedTracker,
        recordChatResponseUsage: (
          sid: string,
          usage: Record<string, number>,
          requestId?: number,
          model?: string
        ) => deps.recordChatResponseUsage(sid, usage, requestId, model),
        toolResultRegistry,
        toolRegistry: deps.getToolRegistry(),
        toolDefinitions,
        buildToolRoundMessages: (
          msgs: unknown,
          am: Message,
          tcs: unknown,
          prs: unknown
        ) =>
          deps.buildToolRoundMessages(
            msgs as Record<string, unknown>[],
            am,
            tcs as ParsedToolCall[],
            prs as Array<{
              normalizedToolCall: ParsedToolCall;
              result: ToolResult;
            }>
          ),
        maxToolTurns: deps.maxToolTurns,
        estimateMessagesTokens,
      } as unknown as import('../ToolLoopRunner.js').ToolLoopContext;

      const { createChatAgentLoop } = await import('../createAgentLoop.js');
      const { reactEventsToChunks } = await import('../reactEventsToChunks.js');
      // 空 assistant 消息占位：ReActToolLoop 首轮直接执行剩余工具，工具轮内自行构建
      // assistant 消息（含叙述/达上限提示），input.assistantMessage 仅作 finalize 兜底 base
      const resumeAssistantMsg = deps.messageService.createAssistantMessage('', {
        sessionId,
      });
      const loop = createChatAgentLoop({
        mode: 'stream',
        ctx: toolLoopCtx,
        input: {
          apiMessages,
          currentToolCalls: remainingToolCalls,
          assistantMessage: resumeAssistantMsg,
          needsInitialLlmCall: false, // 首轮直接执行剩余工具（恢复语义）
        },
        config: { maxIterations: MAX_TOOL_TURNS },
      });

      // 消费 ReActEvent 流 → ChatStreamChunk（含文本增量 reasoning_delta → text chunk）
      let loopMessage: Message | null = null;
      const loopIter = loop.run({
        apiMessages,
        currentToolCalls: remainingToolCalls,
        assistantMessage: resumeAssistantMsg,
      });
      let loopStep = await loopIter.next();
      while (!loopStep.done) {
        for (const chunk of reactEventsToChunks(loopStep.value, sessionId)) {
          yield chunk;
        }
        loopStep = await loopIter.next();
      }
      loopMessage = loopStep.value; // ReActToolLoop.run 返回值（finalize 的 Message）

      // 6. 清理
      deps.sessionAbortControllers.delete(sessionId);

      // ReActToolLoop 已通过 finalize 构建 assistant 消息（含工具轮叙述/达上限提示）；
      // 异常时回退手写构建（CS03）
      const assistantMessage =
        loopMessage ??
        deps.messageService.createAssistantMessage(
          stripBareExploration(
            stripThinkResponseTags(repairImageUrls(accumulatedContent))
          ),
          { sessionId }
        );
      assistantMessage.sessionId = sessionId;
      assistantMessage.finishReason = streamAbortController.signal.aborted
        ? 'abort'
        : 'stop';
      deps.addAndPersistMessage(sessionId, assistantMessage);

      return assistantMessage;
    } finally {
      mutex.release();
    }
  }
}
