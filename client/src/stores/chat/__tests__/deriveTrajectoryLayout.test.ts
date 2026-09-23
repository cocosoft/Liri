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
  filterCollapsedTurns,
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

  it("user/message 在左列；相邻 thinking+text 合并为一个 Step（M2）", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "user/message", { content: "hi" }),
      ev(3, "assistant/thinking", { content: "hmm" }),
      ev(4, "assistant/text", { content: "hello" }),
      ev(5, "turn/end", { turn: 1 }),
    ];
    const layout = deriveTrajectoryLayout(events);
    const steps = layout.turns[0].steps;
    // M2（2026-09-22）：相邻 thinking/text 合并 ⇒ 共 **2 个 Step**（user 一个、思考+正文一个）
    expect(steps).toHaveLength(2);
    expect(steps[0].cells).toHaveLength(1);
    expect(steps[0].cells[0].column).toBe("left"); // user/message
    expect(steps[1].cells).toHaveLength(2); // thinking + text 同 Step
    expect(steps[1].cells.map((c) => c.event.type)).toEqual([
      "assistant/thinking",
      "assistant/text",
    ]);
    expect(steps[1].cells.every((c) => c.column === "right")).toBe(true);
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

describe("M2/M3 分组（2026-09-22）", () => {
  it("M3：tool_call 与其 result 配对为一个 Step（多 cell）", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "assistant/tool_call", {
        toolCallId: "c1",
        name: "grep",
        args: {},
      }),
      ev(3, "tool/result", { callSeq: 2, toolCallId: "c1", result: "ok" }),
      ev(4, "turn/end", { turn: 1 }),
    ];
    const layout = deriveTrajectoryLayout(events);
    const steps = layout.turns[0].steps;
    expect(steps).toHaveLength(1);
    expect(steps[0].cells.map((c) => c.event.type)).toEqual([
      "assistant/tool_call",
      "tool/result",
    ]);
    expect(steps[0].startTime).toBeLessThanOrEqual(steps[0].endTime);
  });

  it("M3：并发工具的 result 乱序到达 ⇒ 仍按 toolCallId 归位（非相邻合并）", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "assistant/tool_call", { toolCallId: "c1", name: "a", args: {} }),
      ev(3, "assistant/tool_call", { toolCallId: "c2", name: "b", args: {} }),
      ev(4, "tool/result", { callSeq: 3, toolCallId: "c2", result: "B" }),
      ev(5, "tool/result", { callSeq: 2, toolCallId: "c1", result: "A" }),
      ev(6, "turn/end", { turn: 1 }),
    ];
    const layout = deriveTrajectoryLayout(events);
    const steps = layout.turns[0].steps;
    expect(steps).toHaveLength(2);
    expect(steps[0].cells.map((c) => c.event.seq)).toEqual([2, 5]); // c1 的 result 是 seq5
    expect(steps[1].cells.map((c) => c.event.seq)).toEqual([3, 4]); // c2 的 result 是 seq4
  });

  it("M3 安全退化：孤立 tool/result（无对应 call）⇒ 独立 Step，不丢弃", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "tool/result", { callSeq: 9, toolCallId: "ghost", result: "x" }),
      ev(3, "turn/end", { turn: 1 }),
    ];
    const layout = deriveTrajectoryLayout(events);
    expect(layout.turns[0].steps).toHaveLength(1);
    expect(layout.turns[0].steps[0].cells[0].event.seq).toBe(2);
  });

  it("M3：配对映射在 turn 边界清空 ⇒ 跨 turn 不误配", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "assistant/tool_call", { toolCallId: "c1", name: "a", args: {} }),
      ev(3, "turn/end", { turn: 1 }),
      ev(4, "turn/start", { turn: 2 }),
      // 同 id 的 result 出现在下一 turn ⇒ **不应**回配到 turn1 的 call
      ev(5, "tool/result", { callSeq: 2, toolCallId: "c1", result: "late" }),
      ev(6, "turn/end", { turn: 2 }),
    ];
    const layout = deriveTrajectoryLayout(events);
    expect(layout.turns[0].steps[0].cells).toHaveLength(1); // 未被追加
    expect(layout.turns[1].steps).toHaveLength(1); // 独立 Step
    expect(layout.turns[1].steps[0].cells[0].event.seq).toBe(5);
  });

  it("M2 边界：thinking 与 text 之间夹入 user/message ⇒ 不跨障碍合并", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "assistant/thinking", { content: "t" }),
      ev(3, "user/message", { content: "u" }),
      ev(4, "assistant/text", { content: "x" }),
      ev(5, "turn/end", { turn: 1 }),
    ];
    const layout = deriveTrajectoryLayout(events);
    const steps = layout.turns[0].steps;
    expect(steps).toHaveLength(3); // 三者各成一 Step
    expect(steps.map((s) => s.cells.length)).toEqual([1, 1, 1]);
  });
});

describe("P2-7 关联编号安全退化（2026-09-22）", () => {
  it("turn/start 缺 turn ⇒ 归入 orphanEvents，不产生非法 Turn", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", {}), // 无 turn
      ev(2, "assistant/text", { content: "x" }),
    ];
    const layout = deriveTrajectoryLayout(events);
    expect(layout.turns).toHaveLength(0);
    expect(layout.orphanEvents.map((e) => e.seq)).toEqual([1, 2]);
    expect(layout.degradedAssocIds).toBe(1);
  });

  it("turn 类型非法（字符串）⇒ 同样退化（不把脏值当编号）", () => {
    const events: LiriEvent[] = [ev(1, "turn/start", { turn: "1" })];
    const layout = deriveTrajectoryLayout(events);
    expect(layout.turns).toHaveLength(0);
    expect(layout.degradedAssocIds).toBe(1);
  });

  it("turn/end 编号非法 ⇒ 归入 orphanEvents 且**不关闭**当前 Turn", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "assistant/text", { content: "x" }),
      ev(3, "turn/end", {}), // 无 turn
    ];
    const layout = deriveTrajectoryLayout(events);
    expect(layout.turns).toHaveLength(1);
    expect(layout.turns[0].completed).toBe(false); // 非法 end 不生效
    expect(layout.orphanEvents.map((e) => e.seq)).toEqual([3]);
    expect(layout.degradedAssocIds).toBe(1);
  });

  it("toolCallId 缺失 / 空串 ⇒ 不登记配对，两侧各自独立 Step（不崩溃、不丢弃）", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "assistant/tool_call", { name: "a", args: {} }), // 无 toolCallId
      ev(3, "tool/result", { callSeq: 1, toolCallId: "", result: "x" }), // 空串
      ev(4, "turn/end", { turn: 1 }),
    ];
    const layout = deriveTrajectoryLayout(events);
    expect(layout.turns[0].steps).toHaveLength(2);
    // **刻意不计入** `degradedAssocIds`：tool 侧"未配对"由 M3 的安全退化覆盖，
    // 与本计数的语义（编号**非法**）不同 ⇒ 两者分离，避免口径混淆。
    expect(layout.degradedAssocIds).toBe(0);
  });

  it("编号合法路径不受影响 ⇒ degradedAssocIds 恒为 0", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "assistant/text", { content: "x" }),
      ev(3, "turn/end", { turn: 1 }),
    ];
    const layout = deriveTrajectoryLayout(events);
    expect(layout.degradedAssocIds).toBe(0);
    expect(layout.turns).toHaveLength(1);
    expect(layout.turns[0].completed).toBe(true);
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

  it("step 多 cell **全部展开**（M2 合并后不丢事件）", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "user/message", { content: "hi" }),
      ev(3, "assistant/text", { content: "a" }),
      ev(4, "assistant/text", { content: "b" }),
      ev(5, "turn/end", { turn: 1 }),
    ];
    const layout = deriveTrajectoryLayout(events);
    // M2（2026-09-22）：两个相邻 assistant/text 合并为 **1 个 Step（2 cells）**
    const steps = layout.turns[0].steps;
    expect(steps).toHaveLength(2); // user + 合并后的 text
    expect(steps[1].cells).toHaveLength(2);

    const rows = flattenLayout(layout);
    // 关键：合并**不减少**行数 —— 每个 cell 仍各占一行（原先"只取 cells[0]"会丢事件）
    expect(rows).toHaveLength(4); // 1 header + 3 事件
    const eventRows = rows.filter((r) => r.kind === "event");
    expect(eventRows).toHaveLength(3);
    expect(eventRows.map((r) => (r as { event: LiriEvent }).event.seq)).toEqual(
      [2, 3, 4],
    );
  });

  it("空 layout → 空 rows", () => {
    expect(flattenLayout(deriveTrajectoryLayout([]))).toEqual([]);
  });
});

// P1-6（2026-09-22）：Turn 折叠过滤（轨迹 Tab 与日志 Tab 共用同一折叠语义）
describe("filterCollapsedTurns：Turn 级折叠", () => {
  /** 两个 turn（各含 1 个事件）+ 1 个孤立事件 ⇒ 5 行 */
  function rows() {
    return flattenLayout(
      deriveTrajectoryLayout([
        ev(1, "turn/start", { turn: 1 }),
        ev(2, "user/message", { content: "a" }),
        ev(3, "turn/end", { turn: 1 }),
        ev(4, "turn/start", { turn: 2 }),
        ev(5, "user/message", { content: "b" }),
        ev(6, "turn/end", { turn: 2 }),
        ev(7, "session/start", { startedAt: 1 }),
      ]),
    );
  }

  it("空折叠集合 ⇒ 原样返回（同一引用，零开销）", () => {
    const r = rows();
    expect(filterCollapsedTurns(r, new Set())).toBe(r);
  });

  it("折叠 turn 1 ⇒ 保留其 turn 头、跳过其事件行；turn 2 不受影响", () => {
    const filtered = filterCollapsedTurns(rows(), new Set([1]));

    // turn 头始终保留（它是折叠入口）
    const headers = filtered.filter((r) => r.kind === "turn-header");
    expect(headers).toHaveLength(2);
    // turn 1 的事件（seq=2）被折叠；turn 2 的事件（seq=5）仍在
    const eventSeqs = filtered
      .filter((r) => r.kind === "event")
      .map((r) => (r.kind === "event" ? r.event.seq : -1));
    expect(eventSeqs).not.toContain(2);
    expect(eventSeqs).toContain(5);
  });

  it("孤立事件（无 turn 归属）始终保留，无 turn 可折叠", () => {
    const filtered = filterCollapsedTurns(rows(), new Set([1, 2]));

    const orphans = filtered.filter(
      (r) => r.kind === "event" && r.turn === undefined,
    );
    expect(orphans).toHaveLength(1);
    expect(orphans[0].kind === "event" && orphans[0].event.seq).toBe(7);
    // 两个 turn 的事件行都被折叠
    expect(
      filtered.filter((r) => r.kind === "event" && r.turn !== undefined),
    ).toHaveLength(0);
  });

  it("折叠不存在的 turn 序号 ⇒ 无影响（不误伤）", () => {
    const r = rows();
    expect(filterCollapsedTurns(r, new Set([99]))).toEqual(r);
  });
});
