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

import type {
  ParsedToolCall,
  ToolAwareClient,
  ToolDefinition,
} from '@modules/ai';
import { estimateMessagesTokens } from '@modules/ai';
import { SimpleMutex } from '@openliri/kernel';
import { getLogger } from '@openliri/infra/monitoring';
import type { LoopDetector } from '@modules/query';
import type { ChatStreamChunk } from '@modules/runtime/api/CoreAPI.js';
import type { Message } from '@modules/session/types/message.js';
import type { ChatSession } from '@modules/session/types/session.js';
import type { LiriEvent } from '@modules/session/types/events';
import { DataSessionStatus } from '@modules/session/types/session.js';
// P1（2026-11-04）：恢复路径的轮次上限同样按会话 chatMode 放大
import { resolveChatModeToolTurns } from '../loopTurnLimits.js';
// P1 收口（2026-11-05）：续跑路径同样按会话 `chatMode` 裁剪工具集（与流式/非流式同一实现）
import {
  filterToolSchemasByChatMode,
  resolveChatModePolicy,
} from '../chatModePolicy.js';
import type { ToolCall, ToolResult } from '@modules/session/types/tool.js';
import type { UnifiedTokenTracker } from '@modules/tokenBudget';
import type { ToolRegistry, ToolSchema } from '@modules/tools';
// P0-2（2026-11-06）：审批恢复后 tool 结果可能被"等待审批提示"隔开 ⇒ 发送前修正顺序
import {
  declaredToolCallsOf,
  dedupeToolResults,
  isReplayedToolResult,
  orderToolResultsAfterOwners,
  toolResultCallIdOf,
} from './resumeMessageOrder.js';

import { StreamingAutoCheckpoint } from '../services/StreamingAutoCheckpoint';
// P1-2（2026-11-06）：会话状态复位后通知前端重取（清掉"待审批"徽标）
import { notifySessionMetaUpdated } from '../services/sessionMetaBroadcast';
import { stripThinkResponseTags } from '../services/MessageContextPipeline';
import { repairImageUrls } from '../services/ChatHelper';
import { stripBareExploration } from '../services/bareExplorationStripper';
import type { MessageService } from '../services/MessageService.js';
import type { PendingInteractionEntry } from '@openliri/infra/utils/pendingInteractions';
// 2026-11-06（审批根因簇 P0-1）：识别「等待审批」的 tool_call —— 批准后必须重放
// 2026-11-12：`planToolReplay` —— 审批未落定的调用不得重放（否则重复写 awaiting_approval）
import {
  extractAwaitingApprovalToolCallIds,
  planToolReplay,
} from '../utils/pendingToolCalls.js';

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
  /**
   * N-6（2026-11-06 真机）：续跑轮实时写 `assistant/tool_call` 事件。
   *
   * 原实现只落最终 assistant 消息（无 tool_call 块）⇒ 续跑轮的工具结果在事件回放里成了
   * **孤儿**（前端只能显示「工具返回 #ID」，没有命令/参数/结构化样式）。这里与流式主路径
   * （`streamMessageToolLoop` 的 tool_start 分支）同源写事件。
   */
  appendStreamEvent: (
    sessionId: string,
    event: LiriEvent
  ) => Promise<{ ok: boolean; reason?: string; tailSeq: number }>;
  /**
   * 2026-11-12（真机 `session_mwd9bnoyc7e3051cde`）：事件日志中已写入的最大 turn 编号。
   *
   * 续跑轮也要有 `turn/start` … `turn/end` 包裹（编号 = 最大 turn + 1）；否则它的
   * text/tool_call/tool_result 事件全落在上一个 `turn/end` 之后 ⇒ 回放侧这段没有 turn 归属
   * （实时侧由聚合器本地补 turn/start），且缺少 `finishReason`/`terminationReason`。
   */
  getStreamMaxTurn: (sessionId: string) => Promise<number>;
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
  /**
   * 2026-11-12：该调用是否**仍在等用户审批**（有未处理的审批卡且放行缓存未写入）——
   * `awaiting_approval` 调用重放的前置条件。
   *
   * 卡还没处理就重放 ⇒ 再执行一次、再提交同一张卡（同指纹复用同一 Inbox 项）、再写一条
   * `awaiting_approval` tool/result（新 messageId）⇒ 前端重复审批卡。故续跑前必须问它。
   * 实现由宿主注入（`isAwaitingUserApproval`：放行缓存 + Inbox 待审批项，与建卡同一口径）。
   */
  isAwaitingUserApproval: (toolCall: ToolCall) => Promise<boolean>;
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
    // 2026-11-12：续跑轮 turn 包裹状态（0 = 未开启）。开启后必须在 finally 收尾，
    // 否则崩溃恢复会把它当成"未闭合 turn"并合成 canceled ⇒ 前端把正常续跑标成「已中断」。
    let resumeTurnNo = 0;
    let resumeFinishReason:
      | 'stop'
      | 'length'
      | 'tool_use'
      | 'error'
      | 'canceled'
      | 'yielded'
      | undefined;
    let resumeTerminationReason: string | undefined;
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
      // P1-2（2026-11-06）：续跑即"用户已处理" ⇒ 内存态同步复位。
      // 存储态由上面的 `resumeSessionState` 复位（已把 requires_action 视作可恢复态），
      // 这里补内存投影，否则同一进程内列表仍显示"待审批"。
      session.state = DataSessionStatus.ACTIVE;
      // P1-2：广播单条会话元数据 ⇒ 前端把"待审批"徽标换回正常态
      await notifySessionMetaUpdated(sessionId);

      // 2. 创建新的 streamAbortController
      const streamAbortController = new AbortController();
      deps.sessionAbortControllers.set(sessionId, streamAbortController);

      // 3. 找到最后一条含 tool_calls 的 assistant 消息，提取剩余工具
      let accumulatedContent = '';
      let remainingToolCalls: ParsedToolCall[] = [];
      // 2026-11-06（审批根因簇 P0-1）：`awaiting_approval` 的 tool/result 虽已落盘，
      // 但**不是终态**——审批通过后必须重放。原实现只按 completedToolCallIds 过滤，
      // 而待审批调用的结果以"成功形状"落盘 ⇒ 被视为已完成 ⇒ 日志打印
      // 「所有工具已完成，无需恢复」，批准后什么都没发生。
      const awaitingApprovalIds = extractAwaitingApprovalToolCallIds(
        session.messages
      );
      // 2026-11-12（真机 `session_mwcyhmmpd44e93b602` / `session_mwd5mp8jd5fe8bce9c`）：
      // **剩余调用全部仍被未处理的审批卡挡住时，本次续跑整体空转**（不重放）。原实现无条件重放
      // ⇒ 续跑（含 `resumeCoalescer` 的补跑一波）再执行一次 ⇒ 同指纹复用同一 Inbox 项 +
      // 再写一条 `awaiting_approval` tool/result（新 messageId）⇒ 前端重复审批卡。
      // 混合场景沿用原口径（见 `planToolReplay` 注释）。
      let stillWaitingApproval = 0;
      for (let i = session.messages.length - 1; i >= 0; i--) {
        const msg = session.messages[i];
        if (msg.role !== 'assistant') continue;
        // N-15：声明可能在 `metadata.tool_calls`，也可能只在顶层 `tool_calls`（事件派生消息）⇒
        // 统一走 `declaredToolCallsOf`，否则重建不出剩余调用（续跑"所有工具已完成"假象）。
        const declared = declaredToolCallsOf(msg);
        if (!declared) continue;
        const tcs = declared as Array<{
          id: string;
          type: string;
          function: { name: string; arguments: string };
        }>;
        const candidates = tcs.filter(
          (tc) =>
            !completedToolCallIds.includes(tc.id) ||
            awaitingApprovalIds.has(tc.id)
        );
        // 逐个问宿主：这张卡是否仍未处理（检查点可能不含 `awaiting_approval` 结果 ⇒ 不能只靠本地标记）
        const blockedIds = new Set<string>();
        for (const tc of candidates) {
          const args =
            typeof tc.function.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments;
          const awaiting = await deps.isAwaitingUserApproval({
            id: tc.id,
            name: tc.function.name,
            arguments: args,
            sessionId,
          });
          if (awaiting) blockedIds.add(tc.id);
        }
        const plan = planToolReplay(candidates, blockedIds);
        stillWaitingApproval = plan.skippedPendingCount;
        remainingToolCalls = plan.replay.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments:
            typeof tc.function.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments,
        }));
        accumulatedContent = typeof msg.content === 'string' ? msg.content : '';
        break;
      }

      if (remainingToolCalls.length === 0) {
        if (stillWaitingApproval > 0) {
          logger.info(
            'resumeStream: 审批尚未落定，本次不重放（避免重复审批卡）',
            {
              sessionId,
              stillWaitingApproval,
            }
          );
          yield {
            type: 'status',
            // `task_all_done` = "本次无可执行项"（`budgetResume` 据此判非实质进展）；
            // 文案如实说明仍在等审批，不得说"任务已全部完成"。
            statusType: 'task_all_done',
            content: `仍在等待审批（${stillWaitingApproval} 个工具未落定），本次续跑未执行任何工具`,
            sessionId,
          } as ChatStreamChunk;
          return (
            session.messages[session.messages.length - 1] || ({} as Message)
          );
        }
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

      // 4. 获取工具定义（P1 收口 2026-11-05：按会话 `chatMode` 裁剪，同一实现）
      const activeClient = deps.getLLMClient();
      const chatModePolicy = resolveChatModePolicy(
        (session.metadata as Record<string, unknown> | undefined)?.chatMode
      );
      const allSchemas = deps.getToolSchemas();
      const toolSchemas = allSchemas
        ? filterToolSchemasByChatMode(allSchemas, chatModePolicy)
        : allSchemas;
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
        // 2026-11-06：其中有多少是"审批已通过、需要重放"的调用
        replayedAwaitingApproval: remainingToolCalls.filter((tc) =>
          awaitingApprovalIds.has(tc.id)
        ).length,
        toolTurnCount: generatorState.toolTurnCount,
      });

      yield {
        type: 'status',
        statusType: 'resume',
        content: `从第 ${stepIndex} 步恢复 — 剩余 ${remainingToolCalls.length} 个工具`,
        sessionId,
      } as ChatStreamChunk;

      // 2026-11-12（真机 `session_mwd9bnoyc7e3051cde`）：续跑轮此前**不写 turn/start**，
      // 其 text/tool_call/tool_result 事件全部落在上一个 `turn/end` 之后 ⇒ 回放时这一段没有
      // turn 归属（实时侧由聚合器本地补 turn/start，二者不对称），也没有 finishReason。
      // 这里与流式主路径同源开启新 turn（编号 = 事件日志最大 turn + 1）。
      try {
        const persistedTurn = await deps.getStreamMaxTurn(sessionId);
        const nextTurn = persistedTurn + 1;
        const started = await deps.appendStreamEvent(sessionId, {
          type: 'turn/start',
          seq: 0,
          time: Date.now(),
          sessionId,
          data: { turn: nextTurn },
        });
        if (started.ok) resumeTurnNo = nextTurn;
      } catch {
        // @ignore-catch — 事件追加失败不阻断续跑（CS03）；未开启 ⇒ finally 也不写 end
        resumeTurnNo = 0;
      }

      // 断线恢复动态上限（2026-09-01）：剩余工具数决定所需轮次，避免恢复的
      // 长任务在基础阈值（30 轮）内被误杀。历史轮次 + 剩余工具 + 5 轮余量。
      // P1（2026-11-04）：基础阈值先按会话 chatMode 放大（deep / code ×2）。
      const toolTurnCount = generatorState.toolTurnCount;
      const MAX_TOOL_TURNS = Math.max(
        resolveChatModeToolTurns(
          deps.maxToolTurns,
          (session.metadata as Record<string, unknown> | undefined)?.chatMode
        ),
        toolTurnCount + remainingToolCalls.length + 5
      );

      // 5. 工具执行循环（轻量模式收敛 2026-09-01：复用 ReActToolLoop，经统一工厂。
      //    对齐 ReActToolLoop.reason 首轮"直接执行剩余工具"语义（needsInitialLlmCall=false），
      //    消除手写循环（原三轨之一）。恢复场景简化语义保持：不启用审批/心跳。
      // 2026-11-06（审批根因簇 P0-1）：重放的调用在历史里**已有**一条 awaiting_approval
      // 的 tool 结果。协议要求每个 tool_call 恰好一条 tool 应答（重复会被 provider 拒绝），
      // 故构建给 LLM 的消息时剔除这条旧结果——重放产出的新结果才是本轮唯一应答。
      // 落盘侧保留两条（"提交过审批" → "批准后实际结果"）作为审计轨迹。
      // N-15（2026-11-06 真机）：占位消息的 `toolCallId` 常落在 `metadata.toolCallId`（持久化形状）
      // 或 `content` 的 JSON 字符串里（续跑内 ReAct 循环形状）⇒ 判定收敛到 `isReplayedToolResult`
      // 单一实现（原内联版只认顶层字段 + 数组 content，漏判 ⇒ 同一 call 应答两次 ⇒ provider 400）。
      const replayIds = new Set(remainingToolCalls.map((tc) => tc.id));
      const apiMessages = session.messages
        .filter((m) => !isReplayedToolResult(m, replayIds))
        .map((m) => {
          // N-15：`tool_call_id` 不能只看顶层字段（占位结果把它放在 `metadata.toolCallId`
          // 或 `content` 的块里）⇒ 统一走 `toolResultCallIdOf`，否则去重无法配对。
          const toolCallId =
            m.role === 'tool' ? toolResultCallIdOf(m) : m.toolCallId;
          // N-15：声明方必须原样带给 provider（`metadata.tool_calls` 为空时回落到顶层
          // `tool_calls`，否则其 tool 结果全成孤立消息 ⇒ 400）。
          const declaredToolCalls =
            m.role === 'assistant' ? declaredToolCallsOf(m) : undefined;
          return {
            role: m.role,
            content:
              typeof m.content === 'string'
                ? m.content
                : JSON.stringify(m.content),
            ...(declaredToolCalls ? { tool_calls: declaredToolCalls } : {}),
            ...(toolCallId ? { tool_call_id: toolCallId } : {}),
          };
        });

      // P0-2（2026-11-06）：`awaiting_approval` 收尾会追加一条"⏸ 等待审批"的 assistant 消息，
      // 它夹在 tool_calls 与其 tool 结果之间 ⇒ provider 400（tool 必须紧跟声明它的 assistant）。
      // 先按 `tool_call_id` 去重（N-15：往次审批留下的"占位 + 真实结果"一对二），再修正顺序（tool 结果移到 owner 之后），
      // 不改业务内容。
      const orderedApiMessages = orderToolResultsAfterOwners(
        dedupeToolResults(apiMessages)
      );

      const { toolResultRegistry } =
        await import('../../tool/ToolResultRegistry.js');
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
      const resumeAssistantMsg = deps.messageService.createAssistantMessage(
        '',
        {
          sessionId,
        }
      );
      const loop = createChatAgentLoop({
        mode: 'stream',
        ctx: toolLoopCtx,
        input: {
          apiMessages: orderedApiMessages as unknown as Array<
            Record<string, unknown>
          >,
          currentToolCalls: remainingToolCalls,
          assistantMessage: resumeAssistantMsg,
          needsInitialLlmCall: false, // 首轮直接执行剩余工具（恢复语义）
        },
        config: { maxIterations: MAX_TOOL_TURNS },
      });

      // 消费 ReActEvent 流 → ChatStreamChunk（含文本增量 reasoning_delta → text chunk）
      let loopMessage: Message | null = null;
      const loopIter = loop.run({
        apiMessages: orderedApiMessages as unknown as Array<
          Record<string, unknown>
        >,
        currentToolCalls: remainingToolCalls,
        assistantMessage: resumeAssistantMsg,
      });
      let loopStep = await loopIter.next();
      // N-6：本条消息（续跑轮唯一持久化的 assistant）已写过的 tool_call 事件数
      let toolCallEventsWritten = 0;
      // N-6：**被重放**的调用在原始回合已写过 assistant/tool_call 事件（tool_start 在
      // 审批闸门之前发出）⇒ 不再重复写，避免同一 callId 挂到两条助手消息上（重复工具卡）。
      const replayedCallIds = new Set(remainingToolCalls.map((tc) => tc.id));
      while (!loopStep.done) {
        const reactEvent = loopStep.value;
        for (const chunk of reactEventsToChunks(reactEvent, sessionId)) {
          yield chunk;
        }
        // N-6（2026-11-06）：与流式主路径同口径，在工具启动时写 assistant/tool_call 事件，
        // 使回放/派生能生成 tool_call 块（否则续跑轮的工具结果只能显示「工具返回 #ID」）。
        // messageId 固定为续跑轮唯一的 assistant 消息 id（本次续跑不产生逐轮消息）。
        if (
          reactEvent.type === 'tool_start' &&
          !replayedCallIds.has(reactEvent.callId)
        ) {
          try {
            const appended = await deps.appendStreamEvent(sessionId, {
              type: 'assistant/tool_call',
              schemaVersion: 1,
              seq: 0,
              time: Date.now(),
              sessionId,
              data: {
                toolCallId: reactEvent.callId,
                name: reactEvent.name,
                args: reactEvent.input ?? {},
                messageId: resumeAssistantMsg.id,
                callSeq: 0,
              },
            } as LiriEvent);
            if (appended.ok) toolCallEventsWritten++;
          } catch {
            // @ignore-catch — 事件追加失败不阻断续跑（CS03）
          }
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
      // 2026-11-12：turn/end 的终态（与上面落盘消息同源；正常收尾 stop，中止 canceled）
      resumeFinishReason = streamAbortController.signal.aborted
        ? 'canceled'
        : 'stop';
      // 终止原因原样透传（与工具轮 `streamMessageToolLoop` 同口径；正常收尾为 `completed`，
      // 前端 `getTerminationNotice` 对其不显示，不制造噪音）。此处不做字面量比较（状态词汇门禁）。
      resumeTerminationReason = loop.getTerminationReason();
      // N-6：tool_call 事件已实时写 ⇒ 落盘时不要由 convertMessage 再生成一遍（避免重复块）
      if (toolCallEventsWritten > 0) {
        assistantMessage.metadata = {
          ...(assistantMessage.metadata ?? {}),
          __toolCallsWritten: true,
        };
      }
      deps.addAndPersistMessage(sessionId, assistantMessage);

      return assistantMessage;
    } finally {
      // 2026-11-12：续跑轮收尾 —— `turn/start` 已写就必须闭合（正常 stop / 中断 canceled /
      // 异常 error 都要写），否则崩溃恢复把这段当"未闭合 turn"合成 canceled，
      // 前端会把正常续跑显示成「该回复已中断」。
      if (resumeTurnNo > 0) {
        try {
          await deps.appendStreamEvent(sessionId, {
            type: 'turn/end',
            seq: 0,
            time: Date.now(),
            sessionId,
            data: {
              turn: resumeTurnNo,
              finishReason: resumeFinishReason ?? 'error',
              ...(resumeTerminationReason
                ? { terminationReason: resumeTerminationReason }
                : {}),
            },
          });
        } catch {
          // @ignore-catch — 收尾事件失败不阻断（CS03）
        }
      }
      mutex.release();
    }
  }
}
