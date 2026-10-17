// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * streamMessageToolLoop —— 流式工具轮主体（`streamMessageFlow` 拆分批 U-18/S1）
 *
 * **来源**：从 `runStreamMessage` 的「处理工具调用 — 流式工具执行循环」整段（约 400 行）外移为
 * **内层 async generator**（先例 P2-1o）：调用方 `yield*` 逐帧转发，chunk 顺序与心跳语义不变。
 *
 * **职责（单一：一轮工具调用如何执行与收尾）**：
 *   ① 回滚轮次登记（`toolResultRegistry.nextRound` + 写操作才扫基线）
 *   ② 工具轮上下文装配（`buildToolLoopContext`）→ 统一循环工厂 → ReActEvent 流消费
 *   ③ 单 in-flight 事件消费 + 5s 心跳（`execution_phase`）+ `assistant/tool_call` 即时落盘
 *   ④ todo 落盘/补发、终止提示补发、终止副作用 flush、跨轮预算持久化、长任务信号分流
 *
 * **行为等价**：日志文案、事件载荷、心跳节流、`.catch` 兜底与异常分支**逐字未变**
 * （仅把局部变量改为入参/返回值）。日志 module 名仍为 `chat:streamFlow`。
 */

import { handleError } from '@modules/error';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import type {
  ParsedToolCall,
  ToolAwareClient,
  ToolDefinition,
} from '@modules/ai';
import type { ChatStreamChunk } from '@modules/runtime/api/CoreAPI.js';
import type {
  ChatResponse,
  Message,
  StreamMessageOptions,
} from '@modules/session/types/message.js';
import type { ChatSession } from '@modules/session/types/session.js';

import { StreamingAutoCheckpoint } from '../services/StreamingAutoCheckpoint.js';
import type { ChatOrchestratorHost } from './ChatOrchestrator.js';
import { buildToolLoopContext } from './streamMessageToolLoopContext.js';
import { maybeStartRollbackRound } from './streamMessageRollbackRound.js';
import {
  buildTodoEventData,
  isStreamedContentSuperset,
} from './streamMessageHelpers.js';
import { getToolExecErrorMessage } from './toolErrorMessages.js';
import type { makeEventEmitter } from './streamMessageEvents.js';

const logger = getLogger('chat:streamFlow');

export interface StreamToolLoopInput {
  host: ChatOrchestratorHost;
  session: ChatSession;
  options?: StreamMessageOptions;
  streamAbortController: AbortController;
  streamingCheckpoint: StreamingAutoCheckpoint;
  activeClient: ToolAwareClient;
  toolDefinitions: ToolDefinition[];
  /** 本轮 API 消息（已是 `Record<string, unknown>[]` 形态） */
  apiMessages: Array<Record<string, unknown>>;
  /** 本轮最终响应（调用方已确认含 tool_calls） */
  finalResponse: ChatResponse;
  /** 本轮助手消息（工具轮内可能被 loop 替换） */
  assistantMessage: Message;
  assistantMessageId: string;
  accumulatedContent: string;
  /** 本回合用户正文（管线 `ctx.content`；回滚轮次结束时使用） */
  pipelineContent: string;
  /** 用户消息 ID（回滚轮次索引映射键） */
  userMessageId: string;
  /** 单一事件 append 入口（P2-1c） */
  emitEvent: ReturnType<typeof makeEventEmitter>;
  /** 流式 span（工具轮起止事件） */
  streamSpan: ReturnType<ReturnType<typeof getOTelTracing>['startSpan']>;
}

export interface StreamToolLoopResult {
  /** 工具轮收尾后的助手消息（可能被 loop 替换） */
  assistantMessage: Message;
  /** TB-16：主循环终止判定（写入 `turn/end.terminationReason`；无循环时 undefined） */
  terminationReason?: string;
}

export async function* runStreamToolLoop(
  input: StreamToolLoopInput
): AsyncGenerator<ChatStreamChunk, StreamToolLoopResult, unknown> {
  const {
    host,
    session,
    options,
    streamAbortController,
    streamingCheckpoint,
    activeClient,
    toolDefinitions,
    apiMessages,
    finalResponse,
    assistantMessageId,
    accumulatedContent,
    pipelineContent,
    userMessageId,
    emitEvent,
    streamSpan,
  } = input;
  let assistantMessage = input.assistantMessage;
  let toolLoopTermination: string | undefined;

  try {
    streamSpan.addEvent('streamMessage.toolLoop.start', {
      'toolCalls.count': finalResponse.tool_calls!.length,
      toolNames: finalResponse.tool_calls!.map((tc: ParsedToolCall) => tc.name),
    });
    let currentMessages: Record<string, unknown>[] = [...apiMessages];
    let currentToolCalls: ParsedToolCall[] = [...finalResponse.tool_calls!];
    let currentAssistantMsg = assistantMessage;
    const firstAssistantContent = String(assistantMessage.content ?? '');

    const { toolResultRegistry } =
      await import('../../tool/ToolResultRegistry');
    const rollbackRoundId = toolResultRegistry.nextRound(session.id);
    if (!session.metadata.roundIndex) session.metadata.roundIndex = {};
    session.metadata.roundIndex[userMessageId] = rollbackRoundId;
    session.metadata.roundCounter = rollbackRoundId;

    // 2026-09-02 修复：仅写操作工具轮次启动文件回滚基线扫描。
    // P2-1k（2026-10-10）：判据（只读性）与动作（启动/跳过 + 失败留痕）一并外移为
    // `maybeStartRollbackRound`（事故背景与 fail-safe 口径见其头注）。
    await maybeStartRollbackRound({
      host,
      sessionId: session.id,
      toolCalls: finalResponse.tool_calls ?? [],
      roundId: rollbackRoundId,
    });

    // T2.3（2026-08-23）：tool_call 事件 seq 映射，供 ReActToolLoop 构造
    // toolResultMsg 时读取（metadata.callSeq），闭环 callSeq 直读（A1③）
    const toolCallSeqMap = new Map<string, number>();
    // P2-1j（2026-10-10）：工具轮上下文**装配**外移为 `buildToolLoopContext`
    // （约 75 行对象字面量 → 一次调用；字段/闭包/注释与断言**逐字搬迁**，见其头注）。
    const toolLoopCtx = buildToolLoopContext({
      host,
      session,
      options,
      abortSignal: streamAbortController.signal,
      streamingCheckpoint,
      activeClient,
      toolDefinitions,
      toolCallSeqMap,
      toolResultRegistry,
    });

    const { createChatAgentLoop } = await import('../createAgentLoop.js');
    const { reactEventsToChunks } = await import('../reactEventsToChunks.js');
    // 阶段 2（2026-09-01）：统一循环工厂（mode='stream'）替代直接 new ReActToolLoop
    const loop = createChatAgentLoop({
      mode: 'stream',
      ctx: toolLoopCtx,
      input: {
        apiMessages,
        currentToolCalls,
        assistantMessage,
      },
      config: { maxIterations: host.MAX_TOOL_TURNS },
    });

    // M1c：骨架事件流 → ChatStreamChunk（转换层）+ 心跳聚合 + todo chunk
    let heartbeatAt = 0;
    // F4（2026-09-04）：工具轮 LLM/工具执行静默 >5s（无事件产出，如长 TTFB）
    // 时由 keepalive 心跳保持 SSE 活性 + 进度可见，防前端"无字节超时"误断
    const HB_MS = 5000;
    const MAX_HEARTBEAT_STEPS = 30;
    const HB_TOKEN = Symbol('hb');
    const runIter = loop
      .run({
        apiMessages,
        currentToolCalls,
        assistantMessage,
      })
      [Symbol.asyncIterator]();
    let lastEventAt = Date.now();
    // C（2026-09-05，方案 §C）：单 in-flight 事件消费——全程只保留一个
    // runIter.next()；心跳先胜时保留该 promise 进入下一轮 race（不再重新
    // next()），避免 async generator 排队 next() 导致事件被静默消费/错位。
    let pendingNext: ReturnType<typeof runIter.next> | null = null;
    while (true) {
      if (!pendingNext) pendingNext = runIter.next();
      const delayMs = Math.max(0, HB_MS - (Date.now() - lastEventAt));
      let hbHandle: ReturnType<typeof setTimeout> | undefined;
      const hbTimer = new Promise<typeof HB_TOKEN>((resolve) => {
        hbHandle = setTimeout(() => resolve(HB_TOKEN), delayMs);
      });
      const raced = await Promise.race([
        pendingNext as ReturnType<typeof runIter.next>,
        hbTimer,
      ]);
      if (raced === HB_TOKEN) {
        const hb = loop.getHeartbeatData();
        const fullSteps = (hb?.completedToolNames ?? []).map((name) => ({
          name,
          status: 'done' as const,
        }));
        const truncated = fullSteps.length > MAX_HEARTBEAT_STEPS;
        yield {
          type: 'execution_phase',
          content: '正在处理，请稍候...',
          sessionId: session.id,
          executionPhase: {
            phase: 'implementing' as const,
            progress: hb?.totalCompletedToolCount ?? 0,
            description: '任务执行中，正在等待模型/工具响应...',
            steps: truncated
              ? fullSteps.slice(-MAX_HEARTBEAT_STEPS)
              : fullSteps,
            totalSteps: fullSteps.length,
            truncated,
            currentStep: '',
          },
        } as ChatStreamChunk;
        lastEventAt = Date.now();
        continue;
      }
      if (hbHandle) clearTimeout(hbHandle);
      pendingNext = null; // 事件已就绪，消费后下轮再取下一个（单 in-flight）
      const { value: event, done } = raced as Awaited<
        ReturnType<typeof runIter.next>
      >;
      lastEventAt = Date.now();
      if (done) break;
      // T1.2 诊断（2026-08-23，[DUP: 前缀）：记录工具事件产出，观察同 callId 是否重复。
      // 根因背景：SSE 层 tool_start/tool_end 序列被重复发送（前端收到 2 遍），
      // 但 events 层（appendStreamEvent）唯一——两条路径独立，此处日志定位产出侧。
      if (event.type === 'tool_start' || event.type === 'tool_end') {
        logger.debug('[DUP:streamFlow] 工具事件产出', {
          sessionId: session.id,
          eventType: event.type,
          callId: (event as { callId: string }).callId,
          ts: Date.now(),
        });
      }
      for (const chunk of reactEventsToChunks(event, session.id)) {
        yield chunk;
      }
      // P0-fix-4（2026-08-23）：工具循环内实时写入 assistant/tool_call 事件。
      // 时机关键：若等到 _finalizeStreamMessage 落盘时才写，tool_call 事件会晚于
      // tool/result（工具循环内 addAndPersistMessage 已写）和 turn/end，导致：
      //   events.jsonl 顺序 = turn/start → text → tool/result → turn/end → assistant/tool_call
      //   （tool_call 无 turn 包裹，回放时工具调用与结果错位）
      // 在 tool_start 事件到达时立即写 assistant/tool_call，保证：
      //   turn/start → text/thinking → assistant/tool_call → tool/result → turn/end
      // 与 _finalizeStreamMessage 落盘时 convertMessage 生成的事件按 id 去重（不会重复写）。
      if (event.type === 'tool_start') {
        try {
          const tArgs =
            (event as { input?: Record<string, unknown> }).input ?? {};
          const tCallId = (event as { callId: string }).callId;
          // P3-7a（2026-09-02）：seq/callSeq 传 0 交由 append 在 mutex 内原子分配
          // （data.callSeq<=0 自动填分配值，A1 闭环）。此前 getStreamTailSeq+1 与
          // tool/result 落盘并发读到同一 tailSeq → duplicate-seq 反复纠正。
          // tool_call 事件自带 messageId + callSeq（A1）；_toolCallSeqMap 由
          // ChatManager.appendStreamEvent 同步维护（toolCallId → event.seq），可重建
          const appendRes = await host.appendStreamEvent(session.id, {
            type: 'assistant/tool_call',
            schemaVersion: 1,
            seq: 0,
            time: Date.now(),
            sessionId: session.id,
            data: {
              toolCallId: tCallId,
              name: (event as { name: string }).name,
              args: tArgs,
              messageId: assistantMessageId,
              callSeq: 0,
            },
          });
          // T2.3（2026-08-23）：记录 tool_call 事件 seq（append 分配的原子值），
          // 供 ReActToolLoop 构造 toolResultMsg 时写入 metadata.callSeq（闭环 A1③）
          toolCallSeqMap.set(tCallId, appendRes?.tailSeq ?? 0);
        } catch {
          // @ignore-catch — 事件追加失败不阻断工具循环（CS03）
        }
      }
      // Fix4（2026-09-05）：acting_start（"执行 N 个工具调用"）落 assistant/status 事件——
      // 此前该状态仅作为 SSE status chunk 到前端（reactEventsToChunks acting_start→status，
      // L68-75），消息块有 status 但轨迹事件无记录（审计：会话 25 条"执行 N 个工具调用"
      // status 块，assistant/status 事件为 0）。工具批启动入轨，供回放与对账。
      if (event.type === 'acting_start') {
        const tCount = (event as { toolCount?: number }).toolCount ?? 0;
        // P2-1c：单一 append 入口（失败不阻断主流程 · CS03）
        await emitEvent({
          // P3-7a: seq 由 append 原子分配（seq: 0）
          type: 'assistant/status',
          schemaVersion: 1,
          seq: 0,
          time: Date.now(),
          sessionId: session.id,
          data: {
            content: `执行 ${tCount} 个工具调用`,
          },
        });
      }
      // todo chunk：工具结果含 _todoData 时产出（对齐旧类 _executeToolRound）
      for (const todoData of loop.getPendingTodos()) {
        // P0 落盘缺口（2026-08-25）：assistant/todo 落盘，data 对齐前端聚合器结构。
        // P2-1c：单一 append 入口（失败不阻断工具循环 · CS03）
        await emitEvent({
          // P3-7a: seq 由 append 原子分配（seq: 0）
          type: 'assistant/todo',
          schemaVersion: 1,
          seq: 0,
          time: Date.now(),
          sessionId: session.id,
          // P2-1f：载荷构造外移为**纯函数**（`buildTodoEventData`；此前与 flush 点**各写一遍**）
          data: buildTodoEventData(todoData),
        });
        yield {
          type: 'todo',
          content: JSON.stringify(todoData),
          sessionId: session.id,
          todoData,
        } as ChatStreamChunk;
      }
      // 心跳：tool_start / tool_end 后每 5s 产出 execution_phase（对齐旧类 _heartbeat）
      // 2026-08-24 姊妹问题修复：tool_start 也触发心跳——长耗时单工具
      //（如 docx 转换/大文件处理）执行中持续反馈"正在执行 xxx"，避免用户
      // 只看到 tool_call 卡片干等、误以为任务卡死。
      if (event.type === 'tool_start' || event.type === 'tool_end') {
        const now = Date.now();
        if (now - heartbeatAt >= 5000) {
          heartbeatAt = now;
          const hb = loop.getHeartbeatData();
          const toolStartName =
            event.type === 'tool_start'
              ? (event as { name?: string }).name
              : undefined;
          // 5. steps 截断：仅保留最近 MAX_HEARTBEAT_STEPS 条，避免长任务心跳体积线性增长
          //   （对齐旧类 ToolLoopRunner._buildExecutionSteps；totalSteps 保留真实计数）
          const fullSteps = hb.completedToolNames.map((name) => ({
            name,
            status: 'done' as const,
          }));
          const truncated = fullSteps.length > MAX_HEARTBEAT_STEPS;
          const steps = truncated
            ? fullSteps.slice(-MAX_HEARTBEAT_STEPS)
            : fullSteps;
          yield {
            type: 'execution_phase',
            content: toolStartName
              ? `正在执行 ${toolStartName}`
              : '正在执行工具',
            sessionId: session.id,
            executionPhase: {
              phase: 'implementing' as const,
              progress: hb.totalCompletedToolCount,
              description: toolStartName
                ? `正在执行 ${toolStartName}，请稍候...`
                : '正在执行工具调用',
              steps,
              totalSteps: fullSteps.length,
              truncated,
              currentStep: toolStartName ?? '',
            },
          } as ChatStreamChunk;
        }
      }
    }
    // P5（2026-09-17）：未消费 todo 补偿/flush——getPendingTodos 取走即清空，
    // 心跳循环 `if (done) break` 提前退出时（:1978 break 早于 :2055 消费点），
    // 最后一批已 push 的 todo 未取走随 loop 丢弃。此处 flush 残留：落盘 + 前端 chunk。
    for (const todoData of loop.getPendingTodos()) {
      // P2-1c：单一 append 入口（补偿落盘失败不阻断主流程 · CS03）
      await emitEvent({
        type: 'assistant/todo',
        schemaVersion: 1,
        seq: 0,
        time: Date.now(),
        sessionId: session.id,
        // P2-1f：与工具轮消费点**共用同一**载荷构造（CS01 去重）
        data: buildTodoEventData(todoData),
      });
      yield {
        type: 'todo',
        content: JSON.stringify(todoData),
        sessionId: session.id,
        todoData,
      } as ChatStreamChunk;
    }
    assistantMessage = loop.getAssistantMessage();
    // O2-4 探针（2026-09-24「会话暴露问题分析与优化方案」§五）：**先取证，再改行为**。
    // 判据见 `isStreamedContentSuperset`；命中即为"多轮替换导致前端多出重复段落 +
    // 流内与落盘不同源"的实证（对应问题清单 W3）。本探针只观测（WARN），不改发流语义。
    {
      const persistedContent =
        typeof assistantMessage.content === 'string'
          ? assistantMessage.content
          : '';
      if (isStreamedContentSuperset(accumulatedContent, persistedContent)) {
        logger.warn(
          'streamMessage:流内正文包含落盘正文（O2-4 探针：多轮替换疑致重复）',
          {
            sessionId: session.id,
            messageId: assistantMessage.id,
            streamedLength: accumulatedContent.length,
            persistedLength: persistedContent.length,
            diff: accumulatedContent.length - persistedContent.length,
          }
        );
      }
    }
    // 三期 F3-1（2026-09-23 修复计划 §六）：等待本轮**终止副作用**（落 Goal）落定。
    // 原实现为 fire-and-forget ⇒ 落盘失败只留一条无人可等的 warn（N4：调用方无法
    // 感知/重试/断言）。此处 await 使其在轮次边界可观测；无副作用时立即 resolve。
    await loop.flushTerminalSettlement();
    // 跨 run 预算（2026-09-25）：把内存 `metadata.toolTurnBudget`（ReActToolLoop 每轮更新）
    // 合并持久化 —— 同一任务的下一次系统续跑（yield 恢复 / self-wake / goal 空闲续接）
    // 才能读到累计消耗作为续期基线。失败不阻断（metadata 已在内存，下次仍有）——
    // 属真实可能失败的外部 IO（CS03）。
    try {
      await host.persistSessionMetadata(session);
    } catch (err) {
      logger.warn('跨 run 轮次预算持久化失败（继续收尾）', {
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // D3（2026-09-25，`.trae/specs/long-task-routing.md` §3.6）：**运行中长任务信号** ⇒ 交宿主
    // 按**既有**升级通道处理（是否升级由 `chat/longTaskEscalation.ts` 的闸门判定：裸会话 +
    // 轮次闸 ≥2 + 非 Code Mode）。宿主未实现该缝（测试桩）⇒ 不升级，行为不变。
    try {
      const longTask = loop.getLongTaskSignal();
      if (longTask.isLongTask && host.onLongTaskSignal) {
        await host.onLongTaskSignal(session, {
          pendingTodoCount: longTask.pendingTodoCount,
          consumedTurns: longTask.consumedTurns,
        });
      }
    } catch (err) {
      logger.warn('长任务信号分流失败（不影响本轮收尾）', {
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // TB-16（2026-09-24）：取值供 `turn/end` 落 `terminationReason`（见上方变量注释）
    toolLoopTermination = loop.getTerminationReason();
    // B1 补发（2026-09-01）：达上限/循环检测的终止提示由 finalize 生成在最终
    // 消息里，但不在 loop.run 事件流（reactEventsToChunks 不产出）→ 前端流式
    // 收不到（实测 fullContentLength 0，用户对任务中断无感知）。此处补发 text chunk。
    const termTip = loop.getTerminationTip();
    if (termTip) {
      yield {
        type: 'text',
        content: termTip,
        sessionId: session.id,
        messageId: assistantMessage.id,
      };
    }
    // 工具循环结束后再次确保标记存在（loop 内部可能创建/替换了新消息对象）
    assistantMessage.metadata = {
      ...(assistantMessage.metadata ?? {}),
      __streamedEventsWritten: true,
    };
    await host
      .endRollbackRound(session.id, pipelineContent, firstAssistantContent)
      .catch((err) => {
        logger.warn('回滚轮次结束失败', { error: String(err) });
        handleError(err, {
          module: 'chat:ChatManager',
          action: 'rollback:endRound',
        }).catch(() => {});
      });
    void currentMessages;
    void currentAssistantMsg;
  } catch (toolExecErr) {
    await handleError(toolExecErr, {
      module: 'chat:ChatManager',
      action: 'streamMessage_toolExecution',
      context: { sessionId: session.id },
    });
    const errMsg = getToolExecErrorMessage(toolExecErr);
    // M1-INV①修复（2026-08-31）：原实现仅 append 到 accumulatedContent（该变量
    // 在工具循环后无消费点，属死代码）——工具循环级错误用户完全无感知。
    // 修复：yield error chunk（前端即时提示）+ system/error 事件落盘（刷新回放可见）。
    // P2-1c：单一 append 入口（失败留痕收敛到单一实现，`warn` 级 · CS03）
    await emitEvent(
      {
        // P3-7a: seq 由 append 原子分配（seq: 0）
        type: 'system/error',
        schemaVersion: 1,
        seq: 0,
        time: Date.now(),
        sessionId: session.id,
        data: {
          module: 'chat:ChatManager',
          message: errMsg.slice(0, 200),
        },
      },
      'warn'
    );
    yield {
      type: 'error',
      content: `工具执行环节出错: ${errMsg.slice(0, 200)}`,
      sessionId: session.id,
    } as ChatStreamChunk;
  }

  return { assistantMessage, terminationReason: toolLoopTermination };
}
