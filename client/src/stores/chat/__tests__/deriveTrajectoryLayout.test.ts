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
import {
  deriveTrajectoryLayout,
  flattenLayout,
} from "../deriveTrajectoryLayout";

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

describe("deriveTrajectoryLayout — M1-8 纯函数", () => {
  it("空 events → 空 layout", () => {
    const layout = deriveTrajectoryLayout([]);
    expect(layout.turns).toEqual([]);
    expect(layout.orphanEvents).toEqual([]);
    expect(layout.totalCount).toBe(0);
    expect(layout.tailSeq).toBe(0);
  });

  it("完整 turn（start → events → end）→ 1 个 turn，completed=true", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "user/message", { content: "hi" }),
      ev(3, "assistant/text", { content: "hello" }),
      ev(4, "turn/end", { turn: 1, finishReason: "stop" }),
    ];
    const layout = deriveTrajectoryLayout(events);
    expect(layout.turns).toHaveLength(1);
    const t = layout.turns[0];
    expect(t.turn).toBe(1);
    expect(t.startSeq).toBe(1);
    expect(t.endSeq).toBe(4);
    expect(t.eventCount).toBe(2); // turn/start + turn/end 不计入
    expect(t.completed).toBe(true);
    expect(t.interrupted).toBe(false);
    expect(layout.orphanEvents).toEqual([]);
    expect(layout.totalCount).toBe(4);
    expect(layout.tailSeq).toBe(4);
  });

  it("user/message 在左列，assistant/* 在右列", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "user/message", { content: "hi" }),
      ev(3, "assistant/thinking", { content: "hmm" }),
      ev(4, "assistant/text", { content: "hello" }),
      ev(5, "turn/end", { turn: 1 }),
    ];
    const layout = deriveTrajectoryLayout(events);
    const steps = layout.turns[0].steps;
    expect(steps[0].cells[0].column).toBe("left"); // user/message
    expect(steps[1].cells[0].column).toBe("right"); // assistant/thinking
    expect(steps[2].cells[0].column).toBe("right"); // assistant/text
  });

  it("turn/end 缺失（流式中断）→ completed=false, interrupted=true", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "assistant/text", { content: "半句话" }),
      // 无 turn/end
    ];
    const layout = deriveTrajectoryLayout(events);
    expect(layout.turns).toHaveLength(1);
    expect(layout.turns[0].completed).toBe(false);
    expect(layout.turns[0].interrupted).toBe(true);
  });

  it("无 turn/start 的事件 → orphanEvents", () => {
    const events: LiriEvent[] = [
      ev(1, "session/start", { startedAt: 1000 }),
      ev(2, "system/info", { module: "test", message: "hi" }),
    ];
    const layout = deriveTrajectoryLayout(events);
    expect(layout.turns).toEqual([]);
    expect(layout.orphanEvents).toHaveLength(2);
    expect(layout.orphanEvents[0].seq).toBe(1);
  });

  it("turn/end 无对应 turn/start → orphanEvents", () => {
    const events: LiriEvent[] = [
      ev(1, "assistant/text", { content: "orphan" }),
      ev(2, "turn/end", { turn: 99 }), // 无对应 start
    ];
    const layout = deriveTrajectoryLayout(events);
    expect(layout.turns).toEqual([]);
    expect(layout.orphanEvents).toHaveLength(2);
  });

  it("多个 turn → turns.length 正确", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "user/message", { content: "first" }),
      ev(3, "turn/end", { turn: 1 }),
      ev(4, "turn/start", { turn: 2 }),
      ev(5, "user/message", { content: "second" }),
      ev(6, "turn/end", { turn: 2 }),
    ];
    const layout = deriveTrajectoryLayout(events);
    expect(layout.turns).toHaveLength(2);
    expect(layout.turns[0].turn).toBe(1);
    expect(layout.turns[1].turn).toBe(2);
    expect(layout.turns[1].startSeq).toBe(4);
    expect(layout.turns[1].endSeq).toBe(6);
  });

  it("嵌套 turn/start：原 Turn 中断并开启新 Turn", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "assistant/text", { content: "前半" }),
      ev(3, "turn/start", { turn: 2 }), // 嵌套
      ev(4, "assistant/text", { content: "后半" }),
      ev(5, "turn/end", { turn: 2 }),
    ];
    const layout = deriveTrajectoryLayout(events);
    expect(layout.turns).toHaveLength(2);
    expect(layout.turns[0].completed).toBe(false);
    expect(layout.turns[0].interrupted).toBe(true);
    expect(layout.turns[1].completed).toBe(true);
  });

  it("纯函数验证：相同输入重放，输出 100% 相同", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "user/message", { content: "x" }),
      ev(3, "assistant/text", { content: "y" }),
      ev(4, "turn/end", { turn: 1 }),
    ];
    const a = deriveTrajectoryLayout(events);
    const b = deriveTrajectoryLayout(events);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("tailSeq = 最后一个事件的 seq（即使中断）", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(7, "assistant/text", { content: "中断" }),
    ];
    const layout = deriveTrajectoryLayout(events);
    expect(layout.tailSeq).toBe(7);
    expect(layout.turns[0].endSeq).toBe(7);
  });
});

describe("flattenLayout — P1 虚拟滚动拍平行（2026-08-25）", () => {
  it("完整 turn → turn-header 行 + 各事件行，key 稳定", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "user/message", { content: "hi" }),
      ev(3, "assistant/text", { content: "hello" }),
      ev(4, "turn/end", { turn: 1, finishReason: "stop" }),
    ];
    const layout = deriveTrajectoryLayout(events);
    const rows = flattenLayout(layout);
    expect(rows).toHaveLength(3); // 1 turn-header + 2 事件
    expect(rows[0]).toMatchObject({ kind: "turn-header", key: "turn-1" });
    expect(rows[1]).toMatchObject({ kind: "event", key: "ev-1-2" });
    expect(rows[1]).toMatchObject({ event: { seq: 2 } });
    expect(rows[2]).toMatchObject({ kind: "event", key: "ev-1-3" });
  });

  it("orphanEvents → 每事件一行，key 含 orphan 前缀", () => {
    const events: LiriEvent[] = [
      ev(1, "session/start", { startedAt: 1000 }),
      ev(2, "system/info", { module: "test", message: "hi" }),
    ];
    const layout = deriveTrajectoryLayout(events);
    const rows = flattenLayout(layout);
    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe("event");
    expect(rows[0].key).toContain("orphan-1");
  });

  it("step 多 cell 只取首个 cell（与旧渲染一致）", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "user/message", { content: "hi" }),
      ev(3, "assistant/text", { content: "a" }),
      ev(4, "assistant/text", { content: "b" }),
      ev(5, "turn/end", { turn: 1 }),
    ];
    const layout = deriveTrajectoryLayout(events);
    const rows = flattenLayout(layout);
    // turn-header(1) + 每个事件一个 step（每 step 1 cell）→ 1 + 3 = 4 行
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.kind === "event")).toHaveLength(3);
  });

  it("空 layout → 空 rows", () => {
    expect(flattenLayout(deriveTrajectoryLayout([]))).toEqual([]);
  });
});
