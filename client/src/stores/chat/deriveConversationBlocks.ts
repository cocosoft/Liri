// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * deriveConversationBlocks — 对话视图派生纯函数
 *
 * M2 核心：从 LiriEvent[] 派生 Message[]，消灭 rebuildBlocksFromContent 启发式反推。
 *
 * 设计原则：
 *  1. 纯函数：相同 events 输入必得相同输出，可重放、可单测
 *  2. thinking 与 text 天然隔离（不同事件 type，不可能互相渗入）
 *  3. tool_call 与 tool/result 按 callSeq 配对（比字符串匹配可靠）
 *  4. 单遍扫描 O(n)
 *
 * 不处理的事件（跳过）：
 *  - system/error, system/warning, system/info, metric/timing
 *  - channel/connect, channel/disconnect, channel/message
 *  - session/start, session/end
 *  - context/summary（仅在轨迹视图显示）
 *  - 未知 type（ignorable）
 */

import type {
  LiriEvent,
  Message,
  MessageBlock,
  DeliverableData,
  DiffData,
} from "@/types";
import {
  createThinkExtractor,
  generateBlockId,
  generateGroupId,
  isInternalTransitionStatus,
  normalizeToolCall,
  stripStructuralTags,
} from "./chat-toolcall.slice";
import type { StreamChunk } from "../../services/chatService";
import {
  cacheToolResult,
  truncateResult,
  MAX_INLINE_RESULT_LENGTH,
} from "./chat-message-shared";
import { createLogger } from "@/utils/logger";

const logger = createLogger("stores:chat:derive");

/** D2（2026-08-24）：已知事件类型集合——与 LiriEventType 保持同步，
 *  用于 default 分支区分"已知但视图无关"与"真正未知"类型 */
const KNOWN_EVENT_TYPES = new Set([
  "turn/start",
  "turn/end",
  "user/message",
  "assistant/thinking",
  "assistant/text",
  "assistant/text-batch",
  "assistant/tool_call",
  "tool/result",
  "tool/canceled",
  "assistant/status",
  "assistant/progress",
  "assistant/question",
  "assistant/todo",
  "assistant/doc_workflow",
  "assistant/truncation",
  "assistant/deliverable",
  "assistant/diff",
  "context/compaction",
  "context/summary",
  "session/summary",
  "system/error",
  "system/warning",
  "system/info",
  "metric/timing",
  "channel/connect",
  "channel/disconnect",
  "channel/message",
  "session/start",
  "session/end",
]);

interface DeriveContext {
  sessionId: string;
  /** M4：流式场景下指定的 assistant message id（覆盖 `asst_${seq}` 自动生成）。
   * 流式渲染时 streamMessageImpl 已提前创建 UUID 占位的 assistant 消息，
   * 派生结果必须沿用此 id，否则 flushSet 做定向替换会命中失败导致空渲染。 */
  assistantMessageId?: string;
}

interface BuilderState {
  /** 当前正在累积的 assistant 消息（同一 turn 内的多个事件归并到一条） */
  current: Message | null;
  /** 最近一条已 flush 的 assistant 消息（2026-08-24 中断提示链路：
   * turn/end 到达时 current 可能已被 flush，finishReason 挂到它上面兜底） */
  lastAssistantMsg: Message | null;
  /** tool_call seq → toolCallId 映射，用于 tool/result 配对 */
  toolCallSeqMap: Map<number, string>;
  /** 已完成的消息列表 */
  messages: Message[];
  /** 当前 turn 编号（用于生成 message id） */
  turn: number;
  /** 当前分组 id（对齐 ChronologicalBlockBuilder.currentGroupId）：
   *  - 同一 turn 内的 status/tool_call/progress/todo/question 共享该组
   *  - text 在工具调用后（hasToolCallSinceLastText）开新组
   *  保证 renderBlocksWithGroups 能把"执行 N 个工具调用" status + 多个 tool_call 合并成一个 ToolExecutionGroup，
   *  而不是每个工具独立渲染成卡片。 */
  currentGroupId: string;
  /** 自上次文本后是否出现过工具调用（对齐 ChronologicalBlockBuilder.hasToolCallSinceLastText） */
  hasToolCallSinceLastText: boolean;
  /** think/response 标签提取器（2026-08-31）：assistant/text 事件兜底——
   * 后端擦洗上线前的存量事件日志中 text delta 可能含 <think>/<response> 协议标签
   * （且常跨 delta 分裂），复用 createThinkExtractor 跨 delta 状态机在派生层拦截：
   * think 内容 → thinking 块，response 剥标签保留内容，孤立标签防误杀。
   * 生命周期 = 一条 assistant 消息（flushCurrent 时 flush 残留并置空）。 */
  thinkExtractor: ReturnType<typeof createThinkExtractor> | null;
}

export function deriveConversationBlocks(
  events: LiriEvent[],
  context?: DeriveContext,
): Message[] {
  const sessionId = context?.sessionId ?? events[0]?.sessionId ?? "unknown";
  const assistantMessageId = context?.assistantMessageId;
  const state: BuilderState = {
    current: null,
    lastAssistantMsg: null,
    toolCallSeqMap: new Map(),
    messages: [],
    turn: 0,
    currentGroupId: generateGroupId(),
    hasToolCallSinceLastText: false,
    thinkExtractor: null,
  };

  // ⚠ 派生器层 seq 去重（第二道防线）：对外部直接调用 derive 的路径生效
  // （例如单测、流式回退分支、手动派生地）。
  // 相同 seq 保留第一条，跳过后续重复行，避免 assistant/text delta 被累加多次。
  const seenSeqs = new Set<number>();
  for (const event of events) {
    if (event && typeof event.seq === "number" && Number.isFinite(event.seq)) {
      if (seenSeqs.has(event.seq)) continue;
      seenSeqs.add(event.seq);
    }
    handleEvent(event, state, sessionId, assistantMessageId);
  }

  // 关闭最后一个未 flush 的 assistant
  flushCurrent(state);

  return state.messages;
}

/**
 * P2-1：增量派生器 —— 复用同一 BuilderState，每次只处理新增事件（O(k)，k=新增数），
 * 替代流式期间每 chunk 对全部历史事件重派生的 O(n) 行为。
 *
 * 渲染契约：
 *  - 已 flush 消息保持稳定引用（memo 友好）；
 *  - 未 flush 的 current 消息每次返回**浅拷贝快照**（新引用），保证 zustand set 后
 *    React 能感知流式变更（若复用原引用，memo 化组件将跳过更新，流式 UI 冻结）。
 */
export class IncrementalDeriver {
  private state: BuilderState = {
    current: null,
    lastAssistantMsg: null,
    toolCallSeqMap: new Map(),
    messages: [],
    turn: 0,
    currentGroupId: generateGroupId(),
    hasToolCallSinceLastText: false,
    thinkExtractor: null,
  };
  /** 已派化到的 events 数组下标（不含） */
  private derivedUpTo = 0;
  /** 已处理过的 event.seq 集合（用于流式期间拦截重复 seq 的事件） */
  private readonly seenSeqs = new Set<number>();

  constructor(private readonly context: DeriveContext) {}

  /**
   * 增量处理 events[derivedUpTo..] 并返回当前完整消息视图。
   * 防御：events 数组变短（基线重置/回放重载）时自动全量重派生。
   */
  derive(events: LiriEvent[]): Message[] {
    if (this.derivedUpTo > events.length) this.reset();
    const sessionId =
      this.context.sessionId ?? events[0]?.sessionId ?? "unknown";
    for (; this.derivedUpTo < events.length; this.derivedUpTo++) {
      const event = events[this.derivedUpTo];
      // ⚠ 增量派生层 seq 去重（流式场景第二道防线）：
      // 后端 SSE / processChunk 可能因重连或重复 flush 推送相同 seq 的事件多次，
      // 这里拦截避免 delta 累加导致内容翻倍。
      if (
        event &&
        typeof event.seq === "number" &&
        Number.isFinite(event.seq)
      ) {
        if (this.seenSeqs.has(event.seq)) {
          logger.debug("[IncrementalDeriver] 跳过重复 seq", {
            seq: event.seq,
            type: event.type,
          });
          continue;
        }
        this.seenSeqs.add(event.seq);
      }
      handleEvent(
        event,
        this.state,
        sessionId,
        this.context.assistantMessageId,
      );
    }
    const out = [...this.state.messages];
    if (this.state.current) {
      out.push(snapshotCurrent(this.state.current));
    }
    return out;
  }

  /** 重置派生状态（基线 events 更换时调用） */
  reset(): void {
    this.state = {
      current: null,
      lastAssistantMsg: null,
      toolCallSeqMap: new Map(),
      messages: [],
      turn: 0,
      currentGroupId: generateGroupId(),
      hasToolCallSinceLastText: false,
      thinkExtractor: null,
    };
    this.derivedUpTo = 0;
    this.seenSeqs.clear();
  }
}

/**
 * current 消息快照：浅拷贝 + blocks 新数组，不改动内部 state。
 * 与 flushCurrent 的兜底一致：blocks 为空时补一个空 text block。
 */
function snapshotCurrent(msg: Message): Message {
  let blocks = msg.blocks!;
  if (blocks.length === 0) {
    blocks = [
      {
        id: generateBlockId(),
        type: "text",
        content: "",
        isStreaming: false,
        groupId: generateGroupId(),
      },
    ];
  }
  return { ...msg, blocks: [...blocks] };
}

function handleEvent(
  event: LiriEvent,
  state: BuilderState,
  sessionId: string,
  assistantMessageId?: string,
): void {
  switch (event.type) {
    case "turn/start": {
      // Turn 边界：关闭上一个 assistant
      flushCurrent(state);
      const data = event.data as { turn: number };
      state.turn = data.turn;
      // 新 turn 开新分组（对齐 ChronologicalBlockBuilder）
      state.currentGroupId = generateGroupId();
      state.hasToolCallSinceLastText = false;
      break;
    }

    case "turn/end": {
      // 2026-08-24 中断提示链路：透传 finishReason 到当前/最近 assistant 消息，
      // 使「有正文但被中断」的消息能被前端识别并显示中断提示。
      // 条件赋值：data.finishReason 为空时不清掉已有值（避免覆盖 3.5 后端派生已补的值）
      const endData = event.data as { finishReason?: string };
      const target = state.current ?? state.lastAssistantMsg;
      if (target && endData.finishReason) {
        target.finishReason = endData.finishReason as Message["finishReason"];
      }
      flushCurrent(state);
      break;
    }

    case "user/message": {
      // 用户消息前必须关闭上一个 assistant
      flushCurrent(state);
      const data = event.data as { content: string; replyToId?: string };
      const userMsg: Message = {
        id: `user_${event.seq}`,
        role: "user",
        content: data.content,
        timestamp: event.time,
        session_id: sessionId,
        blocks: [
          {
            id: generateBlockId(),
            type: "text",
            content: data.content,
            isStreaming: false,
            groupId: generateGroupId(),
          },
        ],
      };
      // F4（2026-08-25）：透传 replyToId，刷新后回复引用（被回复标记/跳转）不丢失
      if (data.replyToId) userMsg.replyToId = data.replyToId;
      state.messages.push(userMsg);
      break;
    }

    case "assistant/thinking": {
      ensureCurrent(state, event, sessionId, assistantMessageId);
      const data = event.data as { content: string };
      // Thinking 是流式 delta，必须合并到"最后一个相邻 thinking 块"的 content 上。
      // 禁止每个 chunk 独立 push 新块（否则会导致 💭 标签重复 + 逐词换行 + thinking/response 碎片混叠）。
      // 剥离结构标签（<response> / <think> 等），避免标签碎片也被 thinking 块显示
      const cleanDelta = stripStructuralTags(data.content ?? "");
      appendThinkingDelta(state, cleanDelta);
      break;
    }

    case "assistant/text-batch":
    case "assistant/text": {
      ensureCurrent(state, event, sessionId, assistantMessageId);
      const data = event.data as { content: string };
      // Think/response 标签兜底（2026-08-31）：后端擦洗上线前的存量事件日志中，
      // text delta 可能含 <think>/<response> 协议标签（截图文证：标签按正文渲染），
      // 且标签常跨 delta 分裂，逐 delta 正则删不干净。
      // 复用 createThinkExtractor 跨 delta 状态机（CS01 归一化）：
      // think 内容 → thinking 块（与原生 reasoning 展示一致），
      // response 剥标签保留内容，孤立标签近距闭合验证防误杀。
      if (!state.thinkExtractor) state.thinkExtractor = createThinkExtractor();
      routeExtractorPieces(
        state,
        state.thinkExtractor.extract({
          type: "text",
          content: data.content ?? "",
        }),
      );
      break;
    }

    case "assistant/tool_call": {
      ensureCurrent(state, event, sessionId, assistantMessageId);
      const data = event.data as {
        toolCallId: string;
        name: string;
        args: unknown;
      };
      const toolCall = normalizeToolCall({
        id: data.toolCallId,
        name: data.name,
        arguments: data.args,
      });
      state.toolCallSeqMap.set(event.seq, data.toolCallId);
      const block: MessageBlock = {
        id: generateBlockId(),
        type: "tool_call",
        content: data.name || "Tool Call",
        toolCall: { ...toolCall, status: "completed" },
        isStreaming: false,
        toolCallId: data.toolCallId,
        // 共享当前组（对齐 ChronologicalBlockBuilder.addToolCall 用 currentGroupId），
        // 使"执行 N 个工具调用" status + 多个 tool_call 合并成一个 ToolExecutionGroup
        groupId: state.currentGroupId,
      };
      state.current!.blocks!.push(block);
      state.current!.tool_calls = state.current!.tool_calls || [];
      state.current!.tool_calls.push(toolCall);
      // 标记自上次文本后有工具调用 → 后续 text 开新组（对齐 addToolCall 设 hasToolCallSinceLastText）
      state.hasToolCallSinceLastText = true;
      break;
    }

    case "tool/result": {
      const data = event.data as {
        callSeq: number;
        toolCallId: string;
        result: string;
        isError?: boolean;
      };
      // 全量结果缓存（供 getToolResultFull 按需获取）
      cacheToolResult(data.toolCallId, data.result);

      // 配对到 tool_call block
      const callSeq = data.callSeq;
      const toolCallId =
        (callSeq > 0 && state.toolCallSeqMap.get(callSeq)) || data.toolCallId;
      // P0-2 修复：配对查找范围扩展到 state.messages（已 flush 消息），
      // 覆盖 tool/result 与 tool_call 跨 turn 边界的场景（回放/断连续传）
      //
      // P0-3 修复（2026-08-23，根因：后端在 turn/end 之后才写入 tool/result，
      // 或重启后无 turn 包裹的 tool/result 在 state.current 为 null 时到达）：
      // 原实现仅当 state.current 存在时才进入配对查找，导致 turn/end 后的
      // tool/result 事件全部丢失（工具结果不显示、顺序错乱）。
      // 修复：无论 state.current 是否存在，都在已 flush 消息中反向查找。
      let block: MessageBlock | undefined;
      if (toolCallId) {
        if (state.current) {
          block = state.current.blocks!.find(
            (b) => b.type === "tool_call" && b.toolCallId === toolCallId,
          );
        }
        // P0-2/P0-3 修复：当前消息未命中（或无 current）→ 在已 flush 的 messages 中反向查找（最近的优先）
        if (!block) {
          for (let i = state.messages.length - 1; i >= 0; i--) {
            const msg = state.messages[i];
            block = msg.blocks?.find(
              (b) => b.type === "tool_call" && b.toolCallId === toolCallId,
            );
            if (block) {
              logger.warn(
                "[P0-3:derive] tool/result 在已 flush 消息中配对成功",
                {
                  toolCallId,
                  callSeq,
                  eventSeq: event.seq,
                  msgIndex: i,
                  msgId: msg.id,
                  hasCurrent: !!state.current,
                },
              );
              break;
            }
          }
        }
        // P0-2 修复：仍未命中 → 记录 warn（避免静默丢失）
        if (!block) {
          logger.warn(
            "[P0-3:derive] tool/result 配对失败，toolCallId 在所有消息中均不存在",
            {
              toolCallId,
              callSeq,
              eventSeq: event.seq,
              currentMsgId: state.current?.id,
              flushedMsgCount: state.messages.length,
            },
          );
        }
      } else {
        logger.warn("[P0-3:derive] tool/result 事件缺少 toolCallId", {
          callSeq,
          eventSeq: event.seq,
        });
      }
      if (block?.toolCall) {
        block.toolCall.result = truncateResult(data.result);
        block.toolCall._hasFullResult =
          data.result.length > MAX_INLINE_RESULT_LENGTH || undefined;
        block.toolCall.status = data.isError ? "failed" : "completed";
      }
      break;
    }

    case "context/compaction": {
      // 上下文压缩作为 status block（phase 标记，不占 meaningful 坑）
      // 仅 compacting 阶段才显示，done 阶段不显示
      const data = event.data as { phase: string };
      if (data.phase === "compacting" && state.current) {
        state.current.blocks!.push({
          id: generateBlockId(),
          type: "status",
          content: "",
          status: "compaction",
          phase: "compacting",
          isStreaming: false,
          groupId: generateGroupId(),
        });
      }
      break;
    }

    // ─── 富块 handler（M4-1-c 扩展） ───

    case "assistant/status": {
      ensureCurrent(state, event, sessionId, assistantMessageId);
      const data = event.data as {
        content: string;
        statusType?: string;
        phase?: "compacting" | "done";
        toolCallId?: string;
        watermark?: { pct: number; severity: "warn" | "compact" };
      };
      // compaction 事件在 context/compaction 分支已处理，这里避免重复
      if (data.statusType === "compaction") break;
      // 内部过渡状态（AI is thinking 等）→ 丢弃，与 ChronologicalBlockBuilder.addStatus
      // 共用 isInternalTransitionStatus，保证流式/回放一致过滤（修复状态块堆积）
      if (isInternalTransitionStatus(data.content, data.statusType)) break;
      // 连续重复 status 去重（对齐 ChronologicalBlockBuilder.addStatus：连续相同 content 跳过），
      // 防止"执行 N 个工具调用"等高频 status 心跳堆积多个同内容块
      const lastBlock =
        state.current!.blocks![state.current!.blocks!.length - 1];
      if (lastBlock?.type === "status" && lastBlock.content === data.content) {
        break;
      }
      state.current!.blocks!.push({
        id: generateBlockId(),
        type: "status",
        content: data.content,
        status: data.statusType,
        phase: data.phase,
        toolCallId: data.toolCallId,
        watermark: data.watermark,
        isStreaming: false,
        // 共享当前组（对齐 ChronologicalBlockBuilder.addStatus 用 currentGroupId），
        // 使"执行 N 个工具调用" status 与后续 tool_call 合并进同一个 ToolExecutionGroup
        groupId: state.currentGroupId,
      });
      break;
    }

    case "assistant/progress": {
      ensureCurrent(state, event, sessionId, assistantMessageId);
      const data = event.data as {
        phase:
          | "analyzing"
          | "designing"
          | "implementing"
          | "verifying"
          | "presenting";
        progress: number;
        description: string;
        steps: Array<{
          name: string;
          status: "pending" | "in_progress" | "done" | "failed";
        }>;
        totalSteps?: number;
        truncated?: boolean;
        currentStep: string;
      };
      const progressData: MessageBlock["progressData"] = {
        phase: data.phase,
        progress: data.progress,
        description: data.description,
        steps: data.steps,
        totalSteps: data.totalSteps,
        truncated: data.truncated,
        currentStep: data.currentStep,
      };
      // 关键修复（2026-08-23）：按 phase 去重 —— 同一次执行中同一 phase 的 progress 心跳
      // （execution_phase 高频心跳）应更新已有块而非重复 push，否则会堆积海量 process block。
      // 对齐旧版 ChronologicalBlockBuilder.addProgress 的 findIndex+replace 语义。
      const idx = state.current!.blocks!.findIndex(
        (b) => b.type === "progress" && b.progressData?.phase === data.phase,
      );
      if (idx !== -1) {
        state.current!.blocks![idx] = {
          ...state.current!.blocks![idx],
          progressData,
          content: data.description,
        };
      } else {
        state.current!.blocks!.push({
          id: generateBlockId(),
          type: "progress",
          content: data.description,
          progressData,
          isStreaming: false,
          groupId: state.currentGroupId,
        });
      }
      break;
    }

    case "assistant/question": {
      ensureCurrent(state, event, sessionId, assistantMessageId);
      const data = event.data as {
        questionId: string;
        question: string;
        header: string;
        options: Array<{ label: string; description?: string }>;
        multiSelect?: boolean;
      };
      state.current!.blocks!.push({
        id: generateBlockId(),
        type: "question",
        content: data.question,
        questionData: {
          questionId: data.questionId,
          question: data.question,
          header: data.header,
          options: data.options,
          multiSelect: data.multiSelect,
        },
        isStreaming: false,
        groupId: state.currentGroupId,
      });
      break;
    }

    case "assistant/todo": {
      ensureCurrent(state, event, sessionId, assistantMessageId);
      const data = event.data as {
        action: "write" | "update";
        taskCard?: {
          title: string;
          status: "planning" | "executing" | "done";
          tasks: Array<{
            id: string;
            name: string;
            status:
              | "pending"
              | "in_progress"
              | "completed"
              | "failed"
              | "blocked"
              | "skipped";
            dependsOn: string[];
            result?: string;
            durationMs?: number;
          }>;
          planId?: string;
        };
        taskId?: string;
        updates?: {
          status?:
            | "pending"
            | "in_progress"
            | "completed"
            | "failed"
            | "blocked"
            | "skipped";
          result?: string;
          durationMs?: number;
        };
      };

      if (data.action === "write" && data.taskCard) {
        // 任务分解重复修复（2026-08-26）：后端 tool_call + todo 双通道各产一条
        // action:"write" 事件（tool_call 无 planId、todo 带 planId，title 相同）。
        // 此前无条件 push → 同计划建两个卡片。改为按 planId/title 查重：
        // 命中已有 todo 块 → 全量替换（新引用触发重渲染）；未命中 → 新建。
        const cardTitle = data.taskCard.title;
        const blocks = state.current!.blocks!;
        const newBlock: MessageBlock = {
          id: generateBlockId(),
          type: "todo",
          content: cardTitle,
          taskCard: {
            title: cardTitle,
            status: data.taskCard.status,
            tasks: data.taskCard.tasks.map((t) => ({
              id: t.id,
              name: t.name,
              status: t.status,
              dependsOn: t.dependsOn || [],
              result: t.result,
              durationMs: t.durationMs,
            })),
            planId: data.taskCard.planId,
          },
          isStreaming: false,
          groupId: state.currentGroupId,
        };
        const planId = data.taskCard.planId;
        const existingIdx = blocks.findIndex(
          (b) =>
            b.type === "todo" &&
            b.taskCard &&
            ((planId && b.taskCard.planId === planId) ||
              b.content === cardTitle),
        );
        if (existingIdx !== -1) {
          blocks[existingIdx] = newBlock;
        } else {
          blocks.push(newBlock);
        }
      } else if (data.action === "update" && data.taskId) {
        // BUG-2+8 修复（2026-08-23）：① 按 taskId 跨所有 todo 块查找——原
        // reverse().find 只命中最后一个 todo 块，多块时更新落错块、跨 turn 静默丢失；
        // ② 更新后替换块对象新引用——原地改 task.status 不换块引用，ChatMessage
        // memo 比较器只比块对象引用 → 判定无变化跳过重渲染（对齐 progress 分支同款修复）。
        //
        // F3 修复（2026-08-24）：对齐 tool/result 的 P0-3 扩展——当前未 flush 消息
        // 未命中时，反向遍历已 flush 的 state.messages 查找（跨 turn todo 更新场景：
        // 第 2 轮 todo_write update 更新第 1 轮创建的 todo，更新事件到达时第 1 轮
        // 已被 turn/start 或 user/message flush 出 current）。
        const updateTodoBlocks = (blocks: MessageBlock[]): MessageBlock[] => {
          let replaced = false;
          const nextBlocks = blocks.map((b) => {
            if (b.type !== "todo" || !b.taskCard) return b;
            const taskIdx = b.taskCard.tasks.findIndex(
              (t) => t.id === data.taskId,
            );
            if (taskIdx === -1) return b;
            replaced = true;
            return {
              ...b,
              taskCard: {
                ...b.taskCard,
                tasks: b.taskCard.tasks.map((t, j) =>
                  j === taskIdx
                    ? {
                        ...t,
                        ...(data.updates?.status
                          ? { status: data.updates.status }
                          : {}),
                        ...(data.updates?.result !== undefined
                          ? { result: data.updates.result }
                          : {}),
                        ...(data.updates?.durationMs !== undefined
                          ? { durationMs: data.updates.durationMs }
                          : {}),
                      }
                    : t,
                ),
              },
            };
          });
          return replaced ? nextBlocks : blocks;
        };

        if (state.current?.blocks) {
          state.current.blocks = updateTodoBlocks(state.current.blocks);
        }
        // F3：当前消息未命中（或无 current）→ 已 flush 消息反向查找（最近的优先）
        const matchedInFlushed = (() => {
          for (let i = state.messages.length - 1; i >= 0; i--) {
            const msg = state.messages[i];
            if (!msg.blocks?.some((b) => b.type === "todo")) continue;
            const updatedBlocks = updateTodoBlocks(msg.blocks);
            if (updatedBlocks !== msg.blocks) {
              state.messages[i] = { ...msg, blocks: updatedBlocks };
              logger.warn("[F3:derive] todo update 在已 flush 消息中命中", {
                taskId: data.taskId,
                msgIndex: i,
                msgId: msg.id,
                eventSeq: event.seq,
              });
              return true;
            }
          }
          return false;
        })();
        if (!matchedInFlushed && state.current === null) {
          logger.warn("[F3:derive] todo update 未命中任何消息", {
            taskId: data.taskId,
            eventSeq: event.seq,
            flushedMsgCount: state.messages.length,
          });
        }
      }
      break;
    }

    case "assistant/doc_workflow": {
      ensureCurrent(state, event, sessionId, assistantMessageId);
      const data = event.data as {
        title: string;
        format: "docx" | "pptx" | "html" | "pdf";
        currentStage: "outline" | "filling" | "compose";
        stages: Record<
          "outline" | "filling" | "compose",
          {
            status:
              | "pending"
              | "in_progress"
              | "awaiting_confirm"
              | "completed"
              | "failed";
            progress?: number;
            description?: string;
            nodes?: Array<{
              id: string;
              title: string;
              status: "pending" | "in_progress" | "completed" | "failed";
              hasImage?: boolean;
            }>;
          }
        >;
        outputFilePath?: string;
        error?: string;
      };
      state.current!.blocks!.push({
        id: generateBlockId(),
        type: "doc_workflow",
        content: data.title,
        docWorkflowData: data,
        isStreaming: false,
        groupId: state.currentGroupId,
      });
      break;
    }

    case "assistant/truncation": {
      ensureCurrent(state, event, sessionId, assistantMessageId);
      const data = event.data as { reason: "length"; suffix: string };
      // 截断提示作为 text 块追加，同时累加到 content
      state.current!.blocks!.push({
        id: generateBlockId(),
        type: "text",
        content: data.suffix,
        isStreaming: false,
        groupId: state.currentGroupId,
      });
      state.current!.content = (state.current!.content || "") + data.suffix;
      break;
    }

    case "assistant/deliverable": {
      ensureCurrent(state, event, sessionId, assistantMessageId);
      const data = event.data as {
        files: DeliverableData["files"];
        summary: string;
        checks?: DeliverableData["checks"];
        actions?: DeliverableData["actions"];
      };
      state.current!.blocks!.push({
        id: generateBlockId(),
        type: "deliverable",
        content: data.summary,
        deliverableData: {
          files: data.files,
          summary: data.summary,
          checks: data.checks,
          actions: data.actions,
        },
        isStreaming: false,
        groupId: state.currentGroupId,
      });
      break;
    }

    case "assistant/diff": {
      ensureCurrent(state, event, sessionId, assistantMessageId);
      const data = event.data as {
        file: string;
        diff: string;
        language?: string;
        stats?: DiffData["stats"];
      };
      state.current!.blocks!.push({
        id: generateBlockId(),
        type: "diff",
        content: data.diff,
        diffData: {
          file: data.file,
          diff: data.diff,
          language: data.language,
          stats: data.stats,
        },
        isStreaming: false,
        groupId: state.currentGroupId,
      });
      break;
    }

    // CM-5（2026-08-25）：Code Mode 执行块——独立块展示代码/状态/输出/内部调用摘要
    case "assistant/code_run": {
      ensureCurrent(state, event, sessionId, assistantMessageId);
      const data = (event.data as MessageBlock["codeRunData"]) ?? {
        code: "",
        round: 0,
        status: "failed",
      };
      state.current!.blocks!.push({
        id: generateBlockId(),
        type: "code_run",
        content: data.code || "Code Run",
        codeRunData: {
          code: data.code,
          round: data.round,
          status: data.status,
          output: data.output,
          error: data.error,
          structuredError: data.structuredError,
          toolCalls: data.toolCalls,
          logs: data.logs,
          durationMs: data.durationMs,
        },
        isStreaming: false,
        groupId: state.currentGroupId,
      });
      break;
    }

    // 其他事件不影响对话视图
    default: {
      // system/error, system/warning, system/info, metric/timing,
      // channel/*, session/*, context/summary, 未知 type
      // D2（2026-08-24）：未知类型告警——仅对非 ignorable 的未知类型 warn
      // （后端 EventLogStorage.read 已用 assertEventReadable 过滤，此处防御直调场景）
      if (!KNOWN_EVENT_TYPES.has(event.type) && event.ignorable !== true) {
        logger.warn("[D2:derive] 遇到未知事件类型", {
          eventSeq: event.seq,
          eventType: event.type,
        });
      }
      break;
    }
  }
}

/**
 * 确保 current assistant 存在
 *
 * M2（T3/G2，2026-08-23）：按事件 messageId 归组——事件自带 messageId 且与
 * 当前消息不一致时，flush 当前 + 切换新消息（流式中间态与后端 messageId 归组
 * 一致，工具轮内容不再并入首轮消息）。status 等无 messageId 事件保持复用
 * 当前消息（不切走），避免工具状态块错位。
 */
function ensureCurrent(
  state: BuilderState,
  event: LiriEvent,
  sessionId: string,
  assistantMessageId?: string,
): void {
  const dataMsgId = (event.data as { messageId?: string }).messageId;
  if (state.current) {
    if (dataMsgId && state.current.id !== dataMsgId) {
      flushCurrent(state);
      state.current = {
        id: dataMsgId,
        role: "assistant",
        content: "",
        timestamp: event.time,
        startedAt: event.time,
        session_id: sessionId,
        blocks: [],
        tool_calls: [],
      };
    }
    return;
  }
  state.current = {
    id: assistantMessageId || dataMsgId || `asst_${event.seq}`,
    role: "assistant",
    content: "",
    timestamp: event.time,
    startedAt: event.time,
    session_id: sessionId,
    blocks: [],
    tool_calls: [],
  };
}

/**
 * thinking delta 合并到最后相邻 thinking 块（不可变更新，L5 修复契约）。
 * 空 delta 直接忽略，不推进 block，保证 UI 不抖。
 */
function appendThinkingDelta(state: BuilderState, cleanDelta: string): void {
  if (!state.current || !cleanDelta) return;
  const blocks = state.current.blocks!;
  const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : null;
  if (lastBlock && lastBlock.type === "thinking") {
    blocks[blocks.length - 1] = {
      ...lastBlock,
      content: `${lastBlock.content}${cleanDelta}`,
    };
  } else {
    blocks.push({
      id: generateBlockId(),
      type: "thinking",
      content: cleanDelta,
      isStreaming: false,
      groupId: state.currentGroupId,
    });
  }
}

/**
 * text delta 合并到最后相邻 text 块（不可变更新 + 工具后开新组 + content 累积）。
 * 空 delta 直接忽略。
 */
function appendTextDelta(state: BuilderState, delta: string): void {
  if (!state.current || !delta) return;
  const blocks = state.current.blocks!;
  const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : null;
  if (lastBlock && lastBlock.type === "text") {
    blocks[blocks.length - 1] = {
      ...lastBlock,
      content: `${lastBlock.content}${delta}`,
    };
  } else {
    // 工具调用后的新正文 → 开新分组（对齐 ChronologicalBlockBuilder：
    // hasToolCallSinceLastText 时 addText 会新建 groupId），
    // 使正文与"工具执行组"分离，不被并入工具卡片组。
    if (state.hasToolCallSinceLastText || lastBlock?.type === "tool_call") {
      state.currentGroupId = generateGroupId();
    }
    state.hasToolCallSinceLastText = false;
    blocks.push({
      id: generateBlockId(),
      type: "text",
      content: delta,
      isStreaming: false,
      groupId: state.currentGroupId,
    });
  }
  // content 字段累积所有 text（保持"完整正文"语义，供搜索/导出）
  state.current.content = (state.current.content || "") + delta;
}

/**
 * 把 think extractor 的产出路由到当前消息块（thinking → thinking 块，text → text 块）。
 */
function routeExtractorPieces(
  state: BuilderState,
  pieces: Generator<StreamChunk, void, unknown>,
): void {
  for (const piece of pieces) {
    if (!piece.content) continue;
    if (piece.type === "thinking") {
      appendThinkingDelta(state, piece.content);
    } else if (piece.type === "text") {
      appendTextDelta(state, piece.content);
    }
  }
}

/**
 * 关闭当前 assistant，推入 messages
 * 消息完成（flush）时移除 progress 块——progress 是执行中的瞬态状态
 * （对齐旧版 ChronologicalBlockBuilder.freezeAll 的移除逻辑），
 * 流式过程中 current 未 flush 前由 snapshotCurrent 保留实时展示，
 * 消息结束/回放时进度已无意义，且应避免进度卡片残留正文。
 */
function flushCurrent(state: BuilderState): void {
  if (!state.current) return;
  const msg = state.current;
  // think extractor 残留 flush（2026-08-31）：消息关闭时落地未闭合标签缓冲
  // （unclosed think → thinking 块，unclosed response → text），随后销毁实例，
  // 保证下一条 assistant 消息的状态机从零开始（生命周期 = 一条消息）。
  if (state.thinkExtractor) {
    routeExtractorPieces(state, state.thinkExtractor.flush());
    state.thinkExtractor = null;
  }
  // 移除 progress 块（瞬态，StatusFloatBar 负责流式中展示，完成后不保留）
  if (msg.blocks!.some((b) => b.type === "progress")) {
    msg.blocks = msg.blocks!.filter((b) => b.type !== "progress");
  }
  // 兜底：blocks 为空时至少有一个空 text block（避免渲染异常）
  if (msg.blocks!.length === 0) {
    msg.blocks!.push({
      id: generateBlockId(),
      type: "text",
      content: "",
      isStreaming: false,
      groupId: generateGroupId(),
    });
  }
  state.messages.push(msg);
  state.current = null;
  // 2026-08-24 中断提示链路：记录最近 flush 的 assistant 消息，
  // 供 turn/end（当前已 flush 时）挂载 finishReason 兜底
  if (msg.role === "assistant") {
    state.lastAssistantMsg = msg;
  }
  state.toolCallSeqMap.clear();
}
