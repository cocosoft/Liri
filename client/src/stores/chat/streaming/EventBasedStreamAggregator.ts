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
 * EventBasedStreamAggregator — M3 流式事件聚合器
 *
 * 职责：维护本地 events[]，从 StreamChunk 派生 LiriEvent 并追加。
 * 渲染时调用 deriveConversationBlocks(events) 重派生 Message[]。
 *
 * 与旧 ChronologicalBlockBuilder 的区别：
 *  - 旧：维护可变 blocks[]，直接操作 block 对象
 *  - 新：维护 events[]，通过纯函数派生 blocks
 *
 * 流式视图 = 回放视图：
 *  - 流式中：appendChunk → getEvents → deriveConversationBlocks → 渲染
 *  - 回放时：loadConversation → getEvents → deriveConversationBlocks → 渲染
 *  - 两条路径共享 deriveConversationBlocks，结果一致
 */

import type { LiriEvent, Message } from "@/types";
import type { StreamChunk } from "@/services/chatService";
import { deriveConversationBlocks } from "../deriveConversationBlocks";

export class EventBasedStreamAggregator {
  /** 本地 events[]（按 seq 升序） */
  private events: LiriEvent[] = [];
  /** 当前 tailSeq（用于分配新 seq） */
  private tailSeq: number = 0;
  /** 当前 turn 编号 */
  private turn: number = 0;
  /** 当前 turn 是否已开启（用于避免重复 turn/start） */
  private turnStarted: boolean = false;
  /** toolCall seq → toolCallId 映射（用于 tool/result 配对） */
  private toolCallSeqMap: Map<number, string> = new Map();
  /** sessionId */
  private sessionId: string = "";
  /** M4：流式场景指定的 assistant message id（覆盖派生产物的 asst_${seq} 自动生成） */
  private assistantMessageId: string | undefined;

  /**
   * 初始化：从后端拉取已有 events 作为基线
   * 避免流式新增事件与历史事件 seq 冲突
   */
  async init(
    events: LiriEvent[],
    sessionId: string,
    options?: { assistantMessageId?: string },
  ): Promise<void> {
    this.events = [...events];
    this.sessionId = sessionId;
    this.assistantMessageId = options?.assistantMessageId;
    this.tailSeq = events.length > 0 ? events[events.length - 1].seq : 0;
    this.toolCallSeqMap.clear();
    this.turnStarted = false;
    this.turn = 0;
    // 重建 toolCallSeqMap 和 turn 状态
    for (const event of events) {
      if (event.type === "assistant/tool_call") {
        const data = event.data as { toolCallId: string };
        this.toolCallSeqMap.set(event.seq, data.toolCallId);
      }
      if (event.type === "turn/start") {
        const data = event.data as { turn: number };
        this.turn = Math.max(this.turn, data.turn);
        this.turnStarted = true;
      }
      if (event.type === "turn/end") {
        this.turnStarted = false;
      }
    }
  }

  /**
   * 追加事件（本地）
   * seq 自动分配为 tailSeq + 1
   */
  appendEvent(event: Omit<LiriEvent, "seq" | "time" | "sessionId">): LiriEvent {
    const fullEvent: LiriEvent = {
      ...event,
      seq: this.tailSeq + 1,
      time: Date.now(),
      sessionId: this.sessionId,
    } as LiriEvent;

    // 维护 toolCallSeqMap
    if (fullEvent.type === "assistant/tool_call") {
      const data = fullEvent.data as { toolCallId: string };
      this.toolCallSeqMap.set(fullEvent.seq, data.toolCallId);
    }

    this.events.push(fullEvent);
    this.tailSeq = fullEvent.seq;
    return fullEvent;
  }

  /**
   * 从 StreamChunk 派生事件并追加
   * 映射表见 M3 方案 §3.2
   */
  appendChunk(chunk: StreamChunk): void {
    switch (chunk.type) {
      case "text": {
        // 流式开始时自动追加 turn/start（如果未开启）
        if (!this.turnStarted) {
          this.startTurn();
        }
        this.appendEvent({
          type: "assistant/text",
          data: { content: chunk.content },
        });
        break;
      }

      case "thinking": {
        if (!this.turnStarted) {
          this.startTurn();
        }
        this.appendEvent({
          type: "assistant/thinking",
          data: { content: chunk.content },
        });
        break;
      }

      case "tool_call": {
        if (!this.turnStarted) {
          this.startTurn();
        }
        if (chunk.toolCall) {
          this.appendEvent({
            type: "assistant/tool_call",
            data: {
              toolCallId: chunk.toolCall.id,
              name: chunk.toolCall.name,
              args: chunk.toolCall.arguments,
            },
          });
          // todo_write 特殊语义：实时转 todo 事件（不等 tool/result）
          if (chunk.toolCall.name === "todo_write") {
            const args = chunk.toolCall.arguments as
              Record<string, unknown> | undefined;
            if (args?.action === "write" && args?.todos) {
              const todos = Array.isArray(args.todos)
                ? (args.todos as Array<Record<string, unknown>>)
                : [];
              const tasks = todos.map((t, idx) => ({
                id: String(t.id || idx + 1),
                name: String(t.name || t.content || `步骤 ${idx + 1}`),
                status:
                  (t.status as
                    | "pending"
                    | "in_progress"
                    | "completed"
                    | "failed"
                    | "blocked"
                    | "skipped") || "pending",
                dependsOn: (t.dependsOn as string[]) || [],
              }));
              const title = String(
                args?.title ||
                  (typeof args?.description === "string"
                    ? args.description
                    : "") ||
                  `任务 (${todos.length} 步)`,
              );
              this.appendEvent({
                type: "assistant/todo",
                data: {
                  action: "write",
                  taskCard: { title, status: "planning", tasks },
                },
              });
            } else if (args?.action === "update") {
              const taskId = String(
                args.todo_id ?? args.todoId ?? args.id ?? "",
              );
              if (taskId) {
                const updates: {
                  status?:
                    | "pending"
                    | "in_progress"
                    | "completed"
                    | "failed"
                    | "blocked"
                    | "skipped";
                  result?: string;
                  durationMs?: number;
                } = {};
                if (args.status)
                  updates.status = args.status as
                    | "pending"
                    | "in_progress"
                    | "completed"
                    | "failed"
                    | "blocked"
                    | "skipped";
                if (args.result) updates.result = args.result as string;
                if (args.durationMs)
                  updates.durationMs = args.durationMs as number;
                this.appendEvent({
                  type: "assistant/todo",
                  data: { action: "update", taskId, updates },
                });
              }
            }
          }
        }
        break;
      }

      case "tool_completed": {
        if (chunk.tool_call_id) {
          // 查找对应的 tool_call seq
          let callSeq = -1;
          for (const [seq, id] of this.toolCallSeqMap) {
            if (id === chunk.tool_call_id) {
              callSeq = seq;
              break;
            }
          }
          const resultStr = chunk.result_data
            ? JSON.stringify(chunk.result_data)
            : chunk.content || "";
          this.appendEvent({
            type: "tool/result",
            data: {
              callSeq,
              toolCallId: chunk.tool_call_id,
              result: resultStr,
              isError: false,
            },
          });
        }
        break;
      }

      case "status": {
        if (!this.turnStarted) this.startTurn();
        // compaction → context/compaction 事件（保留原有语义）
        if (chunk.statusType === "compaction") {
          this.appendEvent({
            type: "context/compaction",
            data: {
              phase:
                (chunk.phase as "start" | "compacting" | "done" | "failed") ||
                "compacting",
            },
          });
        }
        // 同时写 assistant/status 事件，用于对话视图派生 status block
        this.appendEvent({
          type: "assistant/status",
          data: {
            content: chunk.content,
            statusType: chunk.statusType,
            phase: chunk.phase as "compacting" | "done" | undefined,
          },
        });
        break;
      }

      case "reconnect_status": {
        if (!this.turnStarted) this.startTurn();
        this.appendEvent({
          type: "assistant/status",
          data: {
            content: `🔄 ${chunk.content}`,
            statusType: "reconnect",
          },
        });
        break;
      }

      case "context_state": {
        // 异常水位：一次性 status 块，进入事件流
        if (
          chunk.watermarkState &&
          chunk.watermarkState.severity !== "normal"
        ) {
          if (!this.turnStarted) this.startTurn();
          this.appendEvent({
            type: "assistant/status",
            data: {
              content: chunk.content,
              statusType: "watermark",
            },
          });
        }
        // 其他非水位提示（压缩/召回/降级事件）→ status 块
        if (!chunk.watermarkState) {
          const structured = chunk.content.match(
            /上下文水位:\s*(\d+)%\s*\(?(\d+K?)\/(\d+K?)\)?\s*\|\s*severity:(compact|warn)\s*\|\s*ratio:([\d.]+)\s*\|\s*tokens:(\d+)\/(\d+)/,
          );
          const legacy = chunk.content.match(/上下文水位:\s*(\d+)%/);
          if (!structured && !legacy) {
            if (!this.turnStarted) this.startTurn();
            this.appendEvent({
              type: "assistant/status",
              data: { content: chunk.content },
            });
          }
        }
        // normal 水位：高频每 1.5s，不进事件流
        break;
      }

      case "execution_phase": {
        if (chunk.executionPhase) {
          if (!this.turnStarted) this.startTurn();
          const ep = chunk.executionPhase;
          this.appendEvent({
            type: "assistant/progress",
            data: {
              phase:
                (ep.phase as
                  | "analyzing"
                  | "designing"
                  | "implementing"
                  | "verifying"
                  | "presenting") || "analyzing",
              progress: ep.progress || 0,
              description: ep.description || "",
              steps: (
                (ep.steps as Array<{
                  name: string;
                  status: "pending" | "in_progress" | "done" | "failed";
                }>) || []
              ).map((s) => ({
                name: s.name,
                status: s.status,
              })),
              totalSteps: ep.totalSteps,
              truncated: ep.truncated,
              currentStep: ep.currentStep || "",
            },
          });
        }
        break;
      }

      case "question": {
        if (chunk.questionData) {
          if (!this.turnStarted) this.startTurn();
          this.appendEvent({
            type: "assistant/question",
            data: {
              questionId: chunk.questionData.questionId,
              question: chunk.questionData.question,
              header: chunk.questionData.header,
              options: chunk.questionData.options.map((o) => ({
                label: o.label,
                description: o.description,
              })),
              multiSelect: chunk.questionData.multiSelect,
            },
          });
        }
        break;
      }

      case "todo": {
        if (chunk.todoData) {
          if (!this.turnStarted) this.startTurn();
          this.appendEvent({
            type: "assistant/todo",
            data: {
              action: "write",
              taskCard: {
                title: chunk.todoData.title,
                status: chunk.todoData.status,
                tasks: chunk.todoData.tasks.map((t) => ({
                  id: t.id,
                  name: t.name,
                  status: t.status,
                  dependsOn: t.dependsOn || [],
                  result: t.result,
                  durationMs: t.durationMs,
                })),
                planId: chunk.todoData.planId,
              },
            },
          });
        }
        break;
      }

      case "doc_workflow": {
        if (chunk.docWorkflowData) {
          if (!this.turnStarted) this.startTurn();
          this.appendEvent({
            type: "assistant/doc_workflow",
            data: chunk.docWorkflowData,
          });
        }
        break;
      }

      case "usage": {
        // finishReason=length → assistant/truncation 事件
        if (chunk.finishReason === "length") {
          if (!this.turnStarted) this.startTurn();
          this.appendEvent({
            type: "assistant/truncation",
            data: {
              reason: "length",
              suffix:
                "\n\n> ⚠️ **AI 输出已被截断**（max_tokens 限制），请考虑分步提问或增大 max_tokens 设置。",
            },
          });
        }
        break;
      }

      case "error": {
        if (!this.turnStarted) this.startTurn();
        this.appendEvent({
          type: "system/error",
          data: {
            module: "chat:stream",
            action: "streamError",
            error: chunk.content,
            errorCode: chunk.errorCode,
          },
        });
        // 对话视图：错误提示作为 status 块显示（带友好错误摘要，
        // 与旧 blockBuilder 的 friendlyErrorSummary 行为一致）。
        // content 保留原始错误（msg.content 与 store.error 保存原始内容），
        // 用户可见块展示摘要化的错误。
        const friendlyContent = chunk._meta?.friendlySummary
          ? String(chunk._meta.friendlySummary)
          : chunk.content;
        this.appendEvent({
          type: "assistant/status",
          data: {
            content: `❌ ${friendlyContent}`,
            statusType: "error",
          },
        });
        break;
      }

      case "done": {
        // 结束 turn
        if (this.turnStarted) {
          this.endTurn(chunk.finishReason);
        }
        break;
      }

      // 其他 chunk 类型（progress/deliverable/diff 等）：
      // - progress 已并入 execution_phase 分支
      // - deliverable/diff 当前 StreamChunk 定义但 processChunk 未走分支（后续补）
      default:
        break;
    }
  }

  /** 开始新 turn */
  private startTurn(): void {
    this.turn++;
    this.turnStarted = true;
    this.appendEvent({
      type: "turn/start",
      data: { turn: this.turn },
    });
  }

  /** 结束当前 turn */
  private endTurn(finishReason?: string): void {
    this.appendEvent({
      type: "turn/end",
      data: {
        turn: this.turn,
        finishReason: finishReason as
          "stop" | "length" | "tool_use" | "error" | "canceled" | undefined,
      },
    });
    this.turnStarted = false;
  }

  /**
   * 获取当前 events[]（供 deriveConversationBlocks）
   */
  getEvents(): LiriEvent[] {
    return this.events;
  }

  /**
   * 派生当前消息列表（供渲染）
   * 复用 M2-1 的 deriveConversationBlocks 纯函数
   */
  deriveMessages(): Message[] {
    return deriveConversationBlocks(this.events, {
      sessionId: this.sessionId,
      assistantMessageId: this.assistantMessageId,
    });
  }

  /**
   * 获取当前 tailSeq
   */
  getTailSeq(): number {
    return this.tailSeq;
  }

  /**
   * 重置（流式结束时清理）
   */
  reset(): void {
    this.events = [];
    this.tailSeq = 0;
    this.turn = 0;
    this.turnStarted = false;
    this.toolCallSeqMap.clear();
    this.sessionId = "";
    this.assistantMessageId = undefined;
  }
}
