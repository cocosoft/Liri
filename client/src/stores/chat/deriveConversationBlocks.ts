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

import type { LiriEvent, Message, MessageBlock } from "@/types";
import {
  generateBlockId,
  generateGroupId,
  normalizeToolCall,
  stripStructuralTags,
} from "./chat-toolcall.slice";
import {
  cacheToolResult,
  truncateResult,
  MAX_INLINE_RESULT_LENGTH,
} from "./chat-message-shared";

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
  /** tool_call seq → toolCallId 映射，用于 tool/result 配对 */
  toolCallSeqMap: Map<number, string>;
  /** 已完成的消息列表 */
  messages: Message[];
  /** 当前 turn 编号（用于生成 message id） */
  turn: number;
}

export function deriveConversationBlocks(
  events: LiriEvent[],
  context?: DeriveContext,
): Message[] {
  const sessionId = context?.sessionId ?? events[0]?.sessionId ?? "unknown";
  const assistantMessageId = context?.assistantMessageId;
  const state: BuilderState = {
    current: null,
    toolCallSeqMap: new Map(),
    messages: [],
    turn: 0,
  };

  for (const event of events) {
    handleEvent(event, state, sessionId, assistantMessageId);
  }

  // 关闭最后一个未 flush 的 assistant
  flushCurrent(state);

  return state.messages;
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
      break;
    }

    case "turn/end": {
      flushCurrent(state);
      break;
    }

    case "user/message": {
      // 用户消息前必须关闭上一个 assistant
      flushCurrent(state);
      const data = event.data as { content: string };
      state.messages.push({
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
      });
      break;
    }

    case "assistant/thinking": {
      ensureCurrent(state, event, sessionId, assistantMessageId);
      const data = event.data as { content: string };
      // Thinking 是流式 delta，必须合并到"最后一个相邻 thinking 块"的 content 上。
      // 禁止每个 chunk 独立 push 新块（否则会导致 💭 标签重复 + 逐词换行 + thinking/response 碎片混叠）。
      const blocks = state.current!.blocks!;
      // 合并守卫：最后一个块必须是 thinking，且与当前事件共享 groupId
      const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : null;
      // 剥离结构标签（<response> / <think> 等），避免标签碎片也被 thinking 块显示
      const cleanDelta = stripStructuralTags(data.content ?? "");
      if (cleanDelta.length === 0) break; // 空 delta（只有标签碎片）直接忽略，不推进 block，保证 UI 不抖
      if (lastBlock && lastBlock.type === "thinking") {
        // 合并：追加 content（保留中间空格——上一 chunk 末尾没标点时通常需要）
        // 注意：思考内容常以"词/短语"为单位流式到达，一般不额外加空格以免产生多余空白
        lastBlock.content = `${lastBlock.content}${cleanDelta}`;
      } else {
        blocks.push({
          id: generateBlockId(),
          type: "thinking",
          content: cleanDelta,
          isStreaming: false,
          groupId: generateGroupId(),
        });
      }
      break;
    }

    case "assistant/text": {
      ensureCurrent(state, event, sessionId, assistantMessageId);
      const data = event.data as { content: string };
      // Text 是流式 delta，必须合并到"最后一个相邻 text 块"的 content 上。
      // 禁止每个 chunk 独立 push 新块（否则会导致正文逐 token 换行/碎片）。
      const blocks = state.current!.blocks!;
      const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : null;
      if (lastBlock && lastBlock.type === "text") {
        lastBlock.content = `${lastBlock.content}${data.content ?? ""}`;
      } else {
        blocks.push({
          id: generateBlockId(),
          type: "text",
          content: data.content ?? "",
          isStreaming: false,
          groupId: generateGroupId(),
        });
      }
      // content 字段累积所有 text（保持"完整正文"语义，供搜索/导出）
      state.current!.content = (state.current!.content || "") + data.content;
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
        groupId: generateGroupId(),
      };
      state.current!.blocks!.push(block);
      state.current!.tool_calls = state.current!.tool_calls || [];
      state.current!.tool_calls.push(toolCall);
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
      if (state.current && toolCallId) {
        const block = state.current.blocks!.find(
          (b) => b.type === "tool_call" && b.toolCallId === toolCallId,
        );
        if (block?.toolCall) {
          block.toolCall.result = truncateResult(data.result);
          block.toolCall._hasFullResult =
            data.result.length > MAX_INLINE_RESULT_LENGTH || undefined;
          block.toolCall.status = data.isError ? "failed" : "completed";
        }
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
      };
      // compaction 事件在 context/compaction 分支已处理，这里避免重复
      if (data.statusType === "compaction") break;
      state.current!.blocks!.push({
        id: generateBlockId(),
        type: "status",
        content: data.content,
        status: data.statusType,
        phase: data.phase,
        isStreaming: false,
        groupId: generateGroupId(),
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
      state.current!.blocks!.push({
        id: generateBlockId(),
        type: "progress",
        content: data.description,
        progressData: {
          phase: data.phase,
          progress: data.progress,
          description: data.description,
          steps: data.steps,
          totalSteps: data.totalSteps,
          truncated: data.truncated,
          currentStep: data.currentStep,
        },
        isStreaming: false,
        groupId: generateGroupId(),
      });
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
        groupId: generateGroupId(),
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
        state.current!.blocks!.push({
          id: generateBlockId(),
          type: "todo",
          content: data.taskCard.title,
          taskCard: {
            title: data.taskCard.title,
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
          groupId: generateGroupId(),
        });
      } else if (data.action === "update" && data.taskId) {
        // 增量更新：找到最后一个 todo block，更新其 taskCard.tasks 中对应 task
        const todoBlock = [...state.current!.blocks!]
          .reverse()
          .find((b) => b.type === "todo" && b.taskCard);
        if (todoBlock?.taskCard) {
          const task = todoBlock.taskCard.tasks.find(
            (t) => t.id === data.taskId,
          );
          if (task) {
            if (data.updates?.status) task.status = data.updates.status;
            if (data.updates?.result !== undefined)
              task.result = data.updates.result;
            if (data.updates?.durationMs !== undefined)
              task.durationMs = data.updates.durationMs;
          }
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
        groupId: generateGroupId(),
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
        groupId: generateGroupId(),
      });
      state.current!.content = (state.current!.content || "") + data.suffix;
      break;
    }

    // 其他事件不影响对话视图
    default:
      // system/error, system/warning, system/info, metric/timing,
      // channel/*, session/*, context/summary, 未知 type
      break;
  }
}

/**
 * 确保 current assistant 存在
 */
function ensureCurrent(
  state: BuilderState,
  event: LiriEvent,
  sessionId: string,
  assistantMessageId?: string,
): void {
  if (!state.current) {
    state.current = {
      id: assistantMessageId || `asst_${event.seq}`,
      role: "assistant",
      content: "",
      timestamp: event.time,
      startedAt: event.time,
      session_id: sessionId,
      blocks: [],
      tool_calls: [],
    };
  }
}

/**
 * 关闭当前 assistant，推入 messages
 */
function flushCurrent(state: BuilderState): void {
  if (!state.current) return;
  const msg = state.current;
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
  state.toolCallSeqMap.clear();
}
