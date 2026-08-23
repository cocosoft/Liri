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

import { describe, expect, it, beforeEach } from "vitest";
import type { LiriEvent } from "@/types";
import { clearToolResultCache } from "../chat-message-shared";
import { deriveConversationBlocks } from "../deriveConversationBlocks";

const SID = "sid-test";

function ev(
  seq: number,
  type: LiriEvent["type"],
  data: Record<string, unknown> = {},
  time = 1000 + seq,
): LiriEvent {
  return {
    type,
    seq,
    time,
    sessionId: SID,
    data: data as never,
  };
}

// 清理工具结果缓存，避免测试间互相污染
beforeEach(() => {
  clearToolResultCache();
});

describe("deriveConversationBlocks — M2-1 纯函数", () => {
  it("空 events → 空 messages", () => {
    const msgs = deriveConversationBlocks([]);
    expect(msgs).toEqual([]);
  });

  it("单轮：user + assistant/text → 2 条消息", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "user/message", { content: "你好" }),
      ev(3, "assistant/text", { content: "你好！" }),
      ev(4, "turn/end", { turn: 1 }),
    ];
    const msgs = deriveConversationBlocks(events);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("你好");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toBe("你好！");
    // assistant 有一个 text block
    const textBlocks = msgs[1].blocks!.filter((b) => b.type === "text");
    expect(textBlocks).toHaveLength(1);
    expect(textBlocks[0].content).toBe("你好！");
  });

  it("thinking 与 text 天然隔离（不同 block）", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "user/message", { content: "问题" }),
      ev(3, "assistant/thinking", { content: "思考中..." }),
      ev(4, "assistant/text", { content: "回复正文" }),
      ev(5, "turn/end", { turn: 1 }),
    ];
    const msgs = deriveConversationBlocks(events);
    expect(msgs).toHaveLength(2);
    const assistant = msgs[1];
    expect(assistant.role).toBe("assistant");
    // thinking block
    const thinkBlocks = assistant.blocks!.filter((b) => b.type === "thinking");
    expect(thinkBlocks).toHaveLength(1);
    expect(thinkBlocks[0].content).toBe("思考中...");
    // text block（不含 thinking 内容）
    const textBlocks = assistant.blocks!.filter((b) => b.type === "text");
    expect(textBlocks).toHaveLength(1);
    expect(textBlocks[0].content).toBe("回复正文");
    // content 字段仅累积 text（不含 thinking）
    expect(assistant.content).toBe("回复正文");
  });

  it("tool_call + tool/result 按 callSeq 配对", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "user/message", { content: "读文件" }),
      ev(3, "assistant/tool_call", {
        toolCallId: "tc-1",
        name: "read",
        args: { path: "/tmp/a.txt" },
      }),
      ev(4, "tool/result", {
        callSeq: 3,
        toolCallId: "tc-1",
        result: "文件内容",
        isError: false,
      }),
      ev(5, "assistant/text", { content: "文件内容是..." }),
      ev(6, "turn/end", { turn: 1 }),
    ];
    const msgs = deriveConversationBlocks(events);
    const assistant = msgs[1];
    const toolCallBlock = assistant.blocks!.find((b) => b.type === "tool_call");
    expect(toolCallBlock).toBeDefined();
    expect(toolCallBlock!.toolCall?.id).toBe("tc-1");
    expect(toolCallBlock!.toolCall?.result).toBe("文件内容");
    expect(toolCallBlock!.toolCall?.status).toBe("completed");
  });

  it("tool/result isError=true → status='failed'", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "assistant/tool_call", {
        toolCallId: "tc-2",
        name: "bash",
        args: { cmd: "exit 1" },
      }),
      ev(3, "tool/result", {
        callSeq: 2,
        toolCallId: "tc-2",
        result: "失败",
        isError: true,
      }),
      ev(4, "turn/end", { turn: 1 }),
    ];
    const msgs = deriveConversationBlocks(events);
    const toolCallBlock = msgs[0].blocks!.find((b) => b.type === "tool_call");
    expect(toolCallBlock!.toolCall?.status).toBe("failed");
  });

  it("assistant/status 透传结构化字段 + 过滤内部过渡状态", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "assistant/status", {
        content: "正在执行任务...",
        toolCallId: "tc-9",
      }),
      ev(3, "assistant/status", {
        content: "AI is thinking...",
        statusType: "ai_thinking",
      }),
      ev(4, "assistant/status", {
        content: "上下文水位: 92% (118K/128K) | severity:compact | ratio:0.920",
        statusType: "watermark",
        watermark: { pct: 92, severity: "compact" },
      }),
      ev(5, "turn/end", { turn: 1 }),
    ];
    const msgs = deriveConversationBlocks(events);
    const statusBlocks = msgs[0].blocks!.filter((b) => b.type === "status");
    // "AI is thinking..."（statusType=ai_thinking）为内部过渡状态 → 被过滤
    expect(statusBlocks).toHaveLength(2);
    expect(statusBlocks[0].toolCallId).toBe("tc-9");
    expect(statusBlocks[1].status).toBe("watermark");
    expect(statusBlocks[1].watermark).toEqual({ pct: 92, severity: "compact" });
  });

  it("多轮对话：turn/start 边界正确分隔", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "user/message", { content: "第一问" }),
      ev(3, "assistant/text", { content: "第一答" }),
      ev(4, "turn/end", { turn: 1 }),
      ev(5, "turn/start", { turn: 2 }),
      ev(6, "user/message", { content: "第二问" }),
      ev(7, "assistant/text", { content: "第二答" }),
      ev(8, "turn/end", { turn: 2 }),
    ];
    const msgs = deriveConversationBlocks(events);
    expect(msgs).toHaveLength(4);
    expect(msgs[0].content).toBe("第一问");
    expect(msgs[1].content).toBe("第一答");
    expect(msgs[2].content).toBe("第二问");
    expect(msgs[3].content).toBe("第二答");
  });

  it("context/compaction 不混入 text/thinking blocks", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "assistant/text", { content: "回复前半" }),
      ev(3, "context/compaction", { phase: "compacting" }),
      ev(4, "assistant/text", { content: "回复后半" }),
      ev(5, "turn/end", { turn: 1 }),
    ];
    const msgs = deriveConversationBlocks(events);
    const assistant = msgs[0];
    // text blocks 不含 compaction 内容
    const textBlocks = assistant.blocks!.filter((b) => b.type === "text");
    expect(textBlocks).toHaveLength(2);
    expect(textBlocks[0].content).toBe("回复前半");
    expect(textBlocks[1].content).toBe("回复后半");
    // status block（compaction）
    const statusBlocks = assistant.blocks!.filter((b) => b.type === "status");
    expect(statusBlocks).toHaveLength(1);
    expect(statusBlocks[0].status).toBe("compaction");
    expect(statusBlocks[0].phase).toBe("compacting");
  });

  it("context/compaction phase=done 不生成 status block", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "assistant/text", { content: "回复" }),
      ev(3, "context/compaction", { phase: "done" }),
      ev(4, "turn/end", { turn: 1 }),
    ];
    const msgs = deriveConversationBlocks(events);
    const statusBlocks = msgs[0].blocks!.filter((b) => b.type === "status");
    expect(statusBlocks).toHaveLength(0);
  });

  it("未知事件 type 被跳过（向前兼容）", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "user/message", { content: "hi" }),
      ev(3, "assistant/text", { content: "hello" }),
      // 未知 type（ignorable）
      {
        type: "system/error" as never,
        seq: 4,
        time: 1004,
        sessionId: SID,
        data: { module: "x", error: "y" } as never,
      },
      ev(5, "metric/timing", { ttft: 1.2 }),
      ev(6, "turn/end", { turn: 1 }),
    ];
    const msgs = deriveConversationBlocks(events);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
  });

  it("纯函数验证：相同 events 重放，输出 100% 相同（排除 id 时间戳）", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "user/message", { content: "问题" }),
      ev(3, "assistant/thinking", { content: "思考" }),
      ev(4, "assistant/text", { content: "回答" }),
      ev(5, "turn/end", { turn: 1 }),
    ];
    const a = deriveConversationBlocks(events);
    const b = deriveConversationBlocks(events);
    // 结构相同（id 是随机的，比较结构）
    expect(a.length).toBe(b.length);
    expect(a[0].role).toBe(b[0].role);
    expect(a[0].content).toBe(b[0].content);
    expect(a[1].content).toBe(b[1].content);
    expect(a[1].blocks!.length).toBe(b[1].blocks!.length);
    expect(a[1].blocks!.map((b) => b.type)).toEqual(
      b[1].blocks!.map((b) => b.type),
    );
    expect(a[1].blocks!.map((b) => b.content)).toEqual(
      b[1].blocks!.map((b) => b.content),
    );
  });

  it("连续 assistant 事件合并为一条消息（同 turn 内）", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "assistant/thinking", { content: "思路1" }),
      ev(3, "assistant/text", { content: "段1" }),
      ev(4, "assistant/text", { content: "段2" }),
      ev(5, "assistant/thinking", { content: "思路2" }),
      ev(6, "assistant/text", { content: "段3" }),
      ev(7, "turn/end", { turn: 1 }),
    ];
    const msgs = deriveConversationBlocks(events);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("assistant");
    // 3 个 text 段累积到 content
    expect(msgs[0].content).toBe("段1段2段3");
    // 相邻 text delta 合并到最后一个 text 块（流式合并是刻意设计）：
    // 段1+段2 合并 → thinking(思路1) text(段1段2) thinking(思路2) text(段3) = 2 thinking + 2 text
    const thinkBlocks = msgs[0].blocks!.filter((b) => b.type === "thinking");
    const textBlocks = msgs[0].blocks!.filter((b) => b.type === "text");
    expect(thinkBlocks).toHaveLength(2);
    expect(textBlocks).toHaveLength(2);
    expect(textBlocks[0].content).toBe("段1段2");
    expect(textBlocks[1].content).toBe("段3");
  });

  it("tool_call 在 turn 内但无 tool/result → status 保持 completed", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "assistant/tool_call", {
        toolCallId: "tc-orphan",
        name: "read",
        args: {},
      }),
      ev(3, "assistant/text", { content: "回答" }),
      ev(4, "turn/end", { turn: 1 }),
    ];
    const msgs = deriveConversationBlocks(events);
    const toolCallBlock = msgs[0].blocks!.find((b) => b.type === "tool_call");
    expect(toolCallBlock!.toolCall?.status).toBe("completed");
    // result 为 undefined（未配对）
    expect(toolCallBlock!.toolCall?.result).toBeUndefined();
  });

  it("assistant 事件无 turn/start 也能正常构造消息", () => {
    const events: LiriEvent[] = [
      ev(1, "assistant/text", { content: "孤儿回复" }),
    ];
    const msgs = deriveConversationBlocks(events);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("assistant");
    expect(msgs[0].content).toBe("孤儿回复");
  });
});
