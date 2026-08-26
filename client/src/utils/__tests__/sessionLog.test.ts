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

import { describe, expect, it } from "vitest";
import type { LiriEvent } from "@/types";
import { buildLogEventsFromEvents } from "../sessionLog";

const SID = "sid-log";

function ev(
  seq: number,
  type: LiriEvent["type"],
  data: Record<string, unknown> = {},
): LiriEvent {
  return {
    type,
    seq,
    time: 1000 + seq,
    sessionId: SID,
    data: data as never,
  };
}

describe("buildLogEventsFromEvents — 工具终态（B-3）", () => {
  it("tool_call + tool/canceled → canceled 状态（未完成终态）", () => {
    const events: LiriEvent[] = [
      ev(1, "assistant/tool_call", {
        toolCallId: "tc-1",
        name: "glob",
        args: { path: "/x" },
      }),
      ev(2, "tool/canceled", {
        toolCallId: "tc-1",
        reason: "工具调用未完成（工具循环结束/中止）",
      }),
    ];
    const logs = buildLogEventsFromEvents(events);
    expect(logs).toHaveLength(1);
    expect(logs[0].kind).toBe("tool");
    expect(logs[0].status).toBe("canceled");
    expect(logs[0].record?.error).toContain("未完成");
  });

  it("tool_call + tool/result → completed；孤立 tool/canceled 被跳过", () => {
    const events: LiriEvent[] = [
      ev(1, "assistant/tool_call", {
        toolCallId: "tc-1",
        name: "bash",
        args: { cmd: "ls" },
      }),
      ev(2, "tool/result", { toolCallId: "tc-1", result: "ok" }),
      // 孤立 canceled（无对应 tool_call）→ 跳过
      ev(3, "tool/canceled", { toolCallId: "tc-orphan" }),
    ];
    const logs = buildLogEventsFromEvents(events);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe("completed");
  });
});

describe("buildLogEventsFromEvents — thinking/text chunk 合并（P0-A/P0-B，2026-08-26）", () => {
  it("T1: 连续同 messageId thinking chunk ×3 → 1 条，content 拼接，key=evt-{首seq}-thinking", () => {
    const events: LiriEvent[] = [
      ev(1, "assistant/thinking", { content: "思考一", messageId: "m1" }),
      ev(2, "assistant/thinking", { content: "思考二", messageId: "m1" }),
      ev(3, "assistant/thinking", { content: "思考三", messageId: "m1" }),
    ];
    const logs = buildLogEventsFromEvents(events);
    expect(logs).toHaveLength(1);
    expect(logs[0].kind).toBe("thinking");
    expect(logs[0].content).toBe("思考一思考二思考三");
    expect(logs[0].key).toBe("evt-1-thinking");
  });

  it("T2: thinking 中间插入 tool_call（思考→工具→思考）→ 3 条，无跨段合并", () => {
    const events: LiriEvent[] = [
      ev(1, "assistant/thinking", { content: "思考A", messageId: "m1" }),
      ev(2, "assistant/tool_call", {
        toolCallId: "tc-1",
        name: "glob",
        args: { path: "/x" },
      }),
      ev(3, "assistant/thinking", { content: "思考B", messageId: "m1" }),
    ];
    const logs = buildLogEventsFromEvents(events);
    expect(logs).toHaveLength(3);
    expect(logs[0].kind).toBe("thinking");
    expect(logs[0].content).toBe("思考A");
    expect(logs[1].kind).toBe("tool");
    expect(logs[2].kind).toBe("thinking");
    expect(logs[2].content).toBe("思考B");
  });

  it("T3: 不同 messageId 的 thinking 不合并 → 2 条", () => {
    const events: LiriEvent[] = [
      ev(1, "assistant/thinking", { content: "思考A", messageId: "m1" }),
      ev(2, "assistant/thinking", { content: "思考B", messageId: "m2" }),
    ];
    const logs = buildLogEventsFromEvents(events);
    expect(logs).toHaveLength(2);
    expect(logs[0].content).toBe("思考A");
    expect(logs[1].content).toBe("思考B");
  });

  it("T4: 连续 text chunk ×N → 合并为 1 条 text LogEvent（AI 回复锚点）", () => {
    const events: LiriEvent[] = [
      ev(1, "assistant/text", { content: "你好", messageId: "m1" }),
      ev(2, "assistant/text", { content: "世界", messageId: "m1" }),
      ev(3, "assistant/text", { content: "！", messageId: "m1" }),
    ];
    const logs = buildLogEventsFromEvents(events);
    expect(logs).toHaveLength(1);
    expect(logs[0].kind).toBe("text");
    expect(logs[0].content).toBe("你好世界！");
    expect(logs[0].key).toBe("evt-1-text");
  });

  it("T5: text 与 thinking 相邻互不合并", () => {
    const events: LiriEvent[] = [
      ev(1, "assistant/text", { content: "回复", messageId: "m1" }),
      ev(2, "assistant/thinking", { content: "思考", messageId: "m1" }),
    ];
    const logs = buildLogEventsFromEvents(events);
    expect(logs).toHaveLength(2);
    expect(logs[0].kind).toBe("text");
    expect(logs[1].kind).toBe("thinking");
  });

  it("T6: messageId 缺失的历史事件（相邻同类型）→ 按相邻合并（退化规则）", () => {
    const events: LiriEvent[] = [
      ev(1, "assistant/thinking", { content: "思考A" }),
      ev(2, "assistant/thinking", { content: "思考B" }),
    ];
    const logs = buildLogEventsFromEvents(events);
    expect(logs).toHaveLength(1);
    expect(logs[0].content).toBe("思考A思考B");
  });

  it("T7: 空 content / 空数组 → 不产出事件 / 空数组", () => {
    expect(buildLogEventsFromEvents([])).toEqual([]);
    const logs = buildLogEventsFromEvents([
      ev(1, "assistant/thinking", { content: "" }),
      ev(2, "assistant/thinking", { content: "有内容", messageId: "m1" }),
    ]);
    // 空 content 跳过且不开新 pending，仅产出有内容的 1 条
    expect(logs).toHaveLength(1);
    expect(logs[0].content).toBe("有内容");
  });

  it("T8: 工具终态配对不回归（合并器不影响 tool/result 更新）", () => {
    const events: LiriEvent[] = [
      ev(1, "assistant/thinking", { content: "先思考", messageId: "m1" }),
      ev(2, "assistant/tool_call", {
        toolCallId: "tc-1",
        name: "bash",
        args: { cmd: "ls" },
      }),
      ev(3, "tool/result", { toolCallId: "tc-1", result: "ok" }),
      ev(4, "assistant/thinking", { content: "再思考", messageId: "m1" }),
    ];
    const logs = buildLogEventsFromEvents(events);
    expect(logs).toHaveLength(3);
    expect(logs[0].kind).toBe("thinking");
    expect(logs[1].kind).toBe("tool");
    expect(logs[1].status).toBe("completed");
    expect(logs[2].kind).toBe("thinking");
  });
});
