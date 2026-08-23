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
