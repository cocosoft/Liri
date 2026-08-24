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
 * 事件溯源 — 前端事件类型镜像
 *
 * 设计参考：app/src/chat/types/events.ts（后端唯一源）
 *
 * 前端不直接 import 后端类型，按 client/types 约定镜像一份。
 * 双端结构必须保持一致，新增事件类型时双端同步。
 */

// ─── 事件类型枚举 ───────────────────────────────

export type LiriEventType =
  | "turn/start"
  | "turn/end"
  | "user/message"
  | "assistant/thinking"
  | "assistant/text"
  | "assistant/tool_call"
  | "tool/result"
  | "tool/canceled"
  // ─── 富块（M4-1-a 扩展） ───
  | "assistant/status"
  | "assistant/progress"
  | "assistant/question"
  | "assistant/todo"
  | "assistant/doc_workflow"
  | "assistant/truncation"
  | "assistant/deliverable"
  | "assistant/diff"
  | "context/compaction"
  | "context/summary"
  | "system/error"
  | "system/warning"
  | "system/info"
  | "metric/timing"
  | "channel/connect"
  | "channel/disconnect"
  | "channel/message"
  | "session/start"
  | "session/end"
  | "session/title";

// ─── 事件载荷映射 ───────────────────────────────

export interface LiriEventMap {
  "turn/start": { turn: number; userMessageSeq?: number };
  "turn/end": {
    turn: number;
    finishReason?: "stop" | "length" | "tool_use" | "error" | "canceled";
    error?: string;
  };
  "user/message": {
    content: string;
    attachments?: Array<{ path: string; filename: string; size: number }>;
    /** 归属消息 id（P1-5：SSE/事件透传，非流式落盘消息为投影 id） */
    messageId?: string;
  };
  "assistant/thinking": { content: string; messageId?: string };
  "assistant/text": { content: string; messageId?: string };
  "assistant/tool_call": {
    toolCallId: string;
    name: string;
    args: unknown;
    messageId?: string;
  };
  "tool/result": {
    callSeq: number;
    toolCallId: string;
    result: string;
    isError?: boolean;
    /** 归属 assistant 消息 id（P1-5：parentMessageId/parentUuid 回退） */
    messageId?: string;
  };
  /** 工具调用未完成终态（B-2，2026-08-23） */
  "tool/canceled": {
    callSeq: number;
    toolCallId: string;
    reason?: string;
    messageId?: string;
  };
  "context/compaction": {
    phase: "start" | "compacting" | "done" | "failed";
    beforeTokens?: number;
    afterTokens?: number;
    message?: string;
  };
  "context/summary": { summary: string; compactedSeqs: number[] };
  "system/error": {
    module: string;
    action: string;
    error: string;
    errorCode?: string;
    stack?: string;
  };
  "system/warning": { module: string; message: string };
  "system/info": { module: string; message: string };
  "metric/timing": {
    ttft?: number;
    tokens?: number;
    duration?: number;
    stage?: string;
  };
  "channel/connect": { channelType: string; channelId: string };
  "channel/disconnect": {
    channelType: string;
    channelId: string;
    reason?: string;
  };
  "channel/message": { channelType: string; raw: unknown };
  "session/start": { startedAt: number; modelId?: string };
  "session/end": { endedAt: number; reason?: string };
  /** 会话标题快照（D5，2026-08-24，log-only 不入消息 surface） */
  "session/title": {
    title: string;
    source: "preliminary" | "final" | "manual";
  };
  // ─── 富块事件载荷（M4-1-a 扩展） ───
  "assistant/status": {
    content: string;
    statusType?: "compaction" | "watermark" | "reconnect" | "error" | string;
    phase?: "compacting" | "done";
    /** 工具状态块关联的 toolCallId（P1-6：按 toolCallId 去重，替代内容正则） */
    toolCallId?: string;
    /** 结构化水位数据（statusType='watermark' 时存在，P1-3：替代内容正则解析） */
    watermark?: { pct: number; severity: "warn" | "compact" };
  };
  "assistant/progress": {
    phase:
      "analyzing" | "designing" | "implementing" | "verifying" | "presenting";
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
  "assistant/question": {
    questionId: string;
    question: string;
    header: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  };
  "assistant/todo": {
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
          | "cancelled"
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
        | "cancelled"
        | "blocked"
        | "skipped";
      result?: string;
      durationMs?: number;
    };
  };
  "assistant/doc_workflow": {
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
  "assistant/truncation": {
    reason: "length";
    suffix: string;
  };
  "assistant/deliverable": {
    files: Array<{
      path: string;
      change: "added" | "modified" | "deleted";
      status: "pending" | "verified" | "failed";
    }>;
    summary: string;
    checks?: Array<{ name: string; passed: boolean; detail?: string }>;
    actions?: Array<{
      label: string;
      action: "accept" | "reject" | "retry";
      file?: string;
    }>;
  };
  "assistant/diff": {
    file: string;
    diff: string;
    language?: string;
    stats?: { additions: number; deletions: number };
  };
}

// ─── 事件结构 ───────────────────────────────────

export interface LiriEvent<T extends LiriEventType = LiriEventType> {
  type: T;
  seq: number;
  time: number;
  sessionId: string;
  data: LiriEventMap[T];
  /** 事件 schema 版本（P1-5：v1 事件携带 messageId，参与消息聚合；v0 无） */
  schemaVersion?: 1;
  sourceEventSeqs?: number[];
  ignorable?: true;
}

// ─── 事件分类（用于面板过滤） ───────────────────

export type LiriEventCategory =
  "conversation" | "tool" | "context" | "system" | "channel" | "lifecycle";

export function categorizeEvent(type: LiriEventType): LiriEventCategory {
  if (type.startsWith("user/") || type.startsWith("assistant/")) {
    if (type === "assistant/tool_call") return "tool";
    return "conversation";
  }
  if (type === "tool/result" || type === "tool/canceled") return "tool";
  if (type.startsWith("context/")) return "context";
  if (type.startsWith("system/") || type.startsWith("metric/")) return "system";
  if (type.startsWith("channel/")) return "channel";
  return "lifecycle";
}

// ─── 类型守卫 ───────────────────────────────────

export function isLiriEvent(x: unknown): x is LiriEvent {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.type === "string" &&
    typeof e.seq === "number" &&
    typeof e.time === "number" &&
    typeof e.sessionId === "string" &&
    typeof e.data === "object"
  );
}
