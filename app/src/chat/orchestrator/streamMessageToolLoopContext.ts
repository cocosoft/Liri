/**
 * streamMessageFlow 的「**工具循环上下文装配**」——构造 `ToolLoopContext`（P2-1j）。
 *
 * 动因（S3 工具调用 输入准备）：该对象字面量此前**内联**在 `runStreamMessage` 的工具轮分支内
 * （约 **75 行**），逐项把 `host` 能力（执行工具 / 事件写入 / 消息持久化 / 用量回执 / 工具注册表 /
 * 回滚）与**本轮状态**（`session` / `options` / `abortSignal` / 工具定义 / `toolCallSeqMap` /
 * `activeClient` / 流式检查点）绑成 `ReActToolLoop` 的上下文。混在编排函数里 ⇒ 阅读与修改都要
 * 先绕开大段装配代码，且装配项（"工具轮需要哪些 host 能力"）无法单点审阅。
 *
 * 拆分手法（与 P2-1b「打包为单一阶段值」同源）：**装配外移、调用留下** ——
 * 本模块只做"输入 `deps` → 输出 `ToolLoopContext`"；**何时装配、装配后如何使用留在编排函数**。
 *
 * **逐字搬迁**：字段、闭包与注释沿用拆分前口径（含 P0-4 / P2-2 / P1-16 / M1 / A 缺口 / T2.3 等既有接线口径）。
 *
 * Task as-unknown（2026-10-12）：**移除**此前的整体 `as unknown as ToolLoopContext` 断言 ⇒
 * 改用具名注解（`const ctx: ToolLoopContext`）让编译器逐字段校验对象形状；`ToolLoopContextDeps`
 * 中原本为 `unknown` 的字段（`streamingCheckpoint` / `activeClient` / `toolResultRegistry`）收窄为
 * 端口真实类型；仅对 host 侧形状差异保留少量**单字段窄断言**（均注明理由）。
 */

import { estimateMessagesTokens } from '@modules/ai';
import type { ToolDefinition, ParsedToolCall } from '@modules/ai';
import type {
  Message,
  StreamMessageOptions,
} from '@modules/session/types/message.js';
import type { ChatSession } from '@modules/session/types/session.js';
import type { ToolResult } from '@modules/session/types/tool.js';
import { toUsageInfo } from '../services/ChatHelper.js';
import type { StreamingAutoCheckpoint } from '../services/StreamingAutoCheckpoint.js';
import type { ChatOrchestratorHost } from './ChatOrchestrator.js';
import type { ToolLoopContext } from '../ToolLoopRunner.js';

/** 装配 `ToolLoopContext` 所需的输入（本轮状态 + host 能力句柄） */
export interface ToolLoopContextDeps {
  host: ChatOrchestratorHost;
  session: ChatSession;
  options: StreamMessageOptions | undefined;
  /** 取消信号（`ctx.streamAbortController.signal`，端到端透传） */
  abortSignal: AbortSignal;
  /** 流式检查点**实例**（裸 `StreamingAutoCheckpoint`）。**端口装配在本函数内统一进行**
   *  （`toStreamingCheckpointPort`，单一来源）⇒ 调用方一律传裸实例，不再各自包装。 */
  streamingCheckpoint: StreamingAutoCheckpoint;
  /** 本轮 provider client（工具轮复用**同一** client，CS01 不另起第二套） */
  activeClient: ToolLoopContext['activeClient'];
  /** 本轮工具定义（已被任务裁剪，见 `selectToolsForTurn`） */
  toolDefinitions: ToolDefinition[];
  /** 工具轮 `tool_call` 事件 seq 映射（`ReActToolLoop` 回读 `metadata.callSeq` 闭环 A1③） */
  toolCallSeqMap: Map<string, number>;
  /** 工具结果登记表（回滚轮次来源） */
  toolResultRegistry: ToolLoopContext['toolResultRegistry'];
}

/**
 * 构造工具轮 `streamingCheckpoint` 端口（**单一来源**，Task 5 Fix round 1）。
 *
 * 端口 `suspend` 为**必填**（见 `ToolLoopRunner.ts`）⇒ 每个装配点都必须显式接线。恢复路径
 * （`ChatManager.resumeStream`）此前只暴露 `onToolCompleted`、漏接 `suspend` ⇒ 开关开时撞日预算
 * 耗尽会静默 no-op 并登记"已挂起但无检查点"的幽灵态。经此函数装配，编译期即锁定接线。
 */
export function toStreamingCheckpointPort(
  checkpoint: StreamingAutoCheckpoint
): ToolLoopContext['streamingCheckpoint'] {
  return {
    // 保留**唯一一处**窄断言：端口入参为宽形状 `Record<string, unknown>`，而
    // `StreamingAutoCheckpoint.onToolCompleted` 需具体 `ToolCompletedState` —— 二者
    // 仅此一处形状差异（运行时同一对象，调用语义不变）。
    onToolCompleted: (data) =>
      checkpoint.onToolCompleted(
        data as unknown as Parameters<typeof checkpoint.onToolCompleted>[0]
      ),
    suspend: (reason: string) => checkpoint.suspend(reason),
  };
}

/**
 * 装配工具轮上下文（详见模块头注）。
 */
export function buildToolLoopContext(
  deps: ToolLoopContextDeps
): ToolLoopContext {
  const {
    host,
    session,
    options,
    abortSignal,
    streamingCheckpoint,
    activeClient,
    toolDefinitions,
    toolCallSeqMap,
    toolResultRegistry,
  } = deps;
  // 具名注解替代此前的整体 `as unknown as ToolLoopContext` 断言 —— 让编译器逐字段
  // 校验对象形状（收窄 parked 类型盲区）。
  const ctx: ToolLoopContext = {
    session,
    options: options as Record<string, unknown>,
    abortSignal,
    // P0-4（2026-08-14）：透传工具执行事件回调 → ReActToolLoop.act 触发 → CoreAPIImpl
    // onToolCall 收集（带参数 tool_call chunk + 完成状态提示，与 TAOR 路径行为一致）
    onToolCall: options?.onToolCall,
    executeTool: (tc: ParsedToolCall, opts: unknown) =>
      host.executeTool(
        {
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          sessionId: session.id,
        },
        opts as {
          useErrorHandler?: boolean;
          onProgress?: (progress: {
            toolUseID: string;
            data: Record<string, unknown>;
          }) => void;
        }
      ),
    // 工具轮端口要求 `Map<string,{questionId,promise,resolve}>`，而 host 有意把该 Map
    // 暴露为 `Map<string, unknown>`（解耦消费侧）⇒ 单字段窄断言桥接；运行时为**同一 Map 引用**。
    pendingInteractions:
      host.pendingInteractions as ToolLoopContext['pendingInteractions'],
    messageService: host.messageService,
    addAndPersistMessage: (sid: string, msg: Message) =>
      host.addAndPersistMessage(sid, msg),
    checkpointService: host.checkpointService,
    // 端口装配**收敛在此处**（含必填 `suspend`）：两个调用方（流式主链 / 恢复路径）一律传裸实例。
    streamingCheckpoint: toStreamingCheckpointPort(streamingCheckpoint),
    activeClient,
    unifiedTracker: host.unifiedTracker,
    // P2-2（2026-09-23）：`requestId` 可选透传 —— 工具轮是**另一次** LLM 请求。
    // P1-16（2026-10-05）：工具轮现由 `StreamingLlm` 在每次请求发出前自行产
    // `request/start` 并把 seq 作 requestId 透传（见 `chat/streamingLlm.ts`）。
    // 端口契约声明 `usage: unknown`（不保证形状），host 侧要求
    // `Record<string, number> | null | undefined` ⇒ 单字段窄断言桥接（运行时未变）。
    recordChatResponseUsage: (
      sid: string,
      usage: unknown,
      requestId?: number
    ) =>
      host.recordChatResponseUsage(
        sid,
        usage as Record<string, number> | null | undefined,
        requestId
      ),
    onToolUsage: (usage: Record<string, unknown>) => {
      const u = toUsageInfo(usage);
      if (u && options?.onUsage) options.onUsage(u);
    },
    toolResultRegistry,
    // host.getToolRegistry() 声明为 `ToolRegistry | null`，而工具轮端口契约要求非空
    // （工具注册表在装配期已就绪）；保留既有"非空"契约假设，运行时取值未变 ⇒ 单字段窄断言。
    toolRegistry: host.getToolRegistry() as ToolLoopContext['toolRegistry'],
    toolDefinitions,
    loopDetector: host.loopDetector,
    buildToolRoundMessages: (
      msgs: Record<string, unknown>[],
      am: Message,
      tcs: ParsedToolCall[],
      prs: Array<{
        normalizedToolCall: ParsedToolCall;
        result: ToolResult;
      }>
    ) => host.buildToolRoundMessages(msgs, am, tcs, prs),
    // M1 事件溯源（2026-08-23）：桥接 host 事件写入 → ReActToolLoop 工具轮
    // text/thinking chunk 补写 assistant/text、assistant/thinking 事件。
    // 工具轮端口的事件参数为宽形状 `{type: string; …}`，而 host 侧要求判别联合 `LiriEvent`
    // ⇒ 在桥接处单字段窄断言（真实事件本就是 `LiriEvent`，运行时未变）。
    appendStreamEvent: (
      sid: string,
      ev: Parameters<NonNullable<ToolLoopContext['appendStreamEvent']>>[1]
    ) =>
      host.appendStreamEvent(
        sid,
        ev as Parameters<ChatOrchestratorHost['appendStreamEvent']>[1]
      ),
    getStreamTailSeq: (sid: string) => host.getStreamTailSeq(sid),
    // A 缺口修复（2026-09-02，P3-7f 基准）：工具轮正文聚合缓冲透传——
    // 与主回复流共用同一 text-batch 缓冲，工具轮 text chunk 不再逐条落盘
    bufferTextChunk: (sid: string, messageId: string, content: string) =>
      host.bufferStreamTextChunk(sid, messageId, content),
    flushTextBuffer: (sid: string) => host.flushStreamEventBuffer(sid),
    // T2.3（2026-08-23）：tool_call 事件 seq 映射（闭环 callSeq 直读）
    toolCallSeqMap,
    maxToolTurns: host.MAX_TOOL_TURNS,
    estimateMessagesTokens: estimateMessagesTokens as (
      messages: unknown[]
    ) => number,
  };
  return ctx;
}
