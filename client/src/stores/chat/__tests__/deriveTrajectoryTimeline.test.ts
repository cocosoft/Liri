// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 时间线纯函数单测
 *
 * P1-4 第一步（只读投影）：
 * - 跨度**只来自配对事件（turn / 工具调用）的真实墙钟差**，不做任何时长估算；
 * - 未参与配对的事件只作为"位置标记"，并计入 `markersWithoutSpan`（供 UI 如实说明）；
 * - 时间域退化（无事件 / 同一时刻）⇒ `null`。
 *
 * P1-4 第二步（视图窗口数学）：缩放 / 平移 / 钳制的**不变量**（
 * `full.start <= start < end <= full.end`、跨度 ∈ `[minRatio×全跨度, 全跨度]`）。
 */
import { describe, it, expect } from "vitest";
import {
  clampTimelineView,
  deriveTrajectoryTimeline,
  formatDuration,
  panTimelineView,
  timeToPercent,
  zoomTimelineView,
  type TimelineView,
} from "../deriveTrajectoryTimeline";
import type { LiriEvent } from "@/types";

function ev(
  seq: number,
  time: number,
  type: LiriEvent["type"],
  data: Record<string, unknown> = {},
): LiriEvent {
  return { type, seq, time, sessionId: "s1", data } as unknown as LiriEvent;
}

describe("deriveTrajectoryTimeline", () => {
  it("无事件 / 时间域退化 ⇒ null（不硬凑一张图）", () => {
    expect(deriveTrajectoryTimeline([])).toBeNull();
    expect(
      deriveTrajectoryTimeline([
        ev(1, 1000, "turn/start", { turn: 1 }),
        ev(2, 1000, "turn/end", { turn: 1 }),
      ]),
    ).toBeNull();
  });

  it("turn 配对 ⇒ 跨度来自两个事件的真实时间差", () => {
    const m = deriveTrajectoryTimeline([
      ev(1, 1000, "turn/start", { turn: 1 }),
      ev(2, 3000, "user/message", { content: "hi" }),
      ev(3, 9000, "turn/end", { turn: 1 }),
    ]);

    expect(m).not.toBeNull();
    expect(m!.spans).toHaveLength(1);
    expect(m!.spans[0]).toMatchObject({
      kind: "turn",
      id: "turn:1",
      startSeq: 1,
      endSeq: 3,
      start: 1000,
      end: 9000,
      isError: false,
    });
    expect(m!.totalMs).toBe(8000);
    expect(m!.busyMs).toBe(8000);
    // 中间那条 user/message 未参与配对 ⇒ 只有位置
    expect(m!.markersWithoutSpan).toBe(1);
  });

  it("turn 缺 end ⇒ 不生成跨度（不估算），全部标记计为无长度", () => {
    const m = deriveTrajectoryTimeline([
      ev(1, 1000, "turn/start", { turn: 1 }),
      ev(2, 5000, "assistant/text", { content: "x" }),
    ]);

    expect(m!.spans).toHaveLength(0);
    expect(m!.busyMs).toBe(0);
    expect(m!.markersWithoutSpan).toBe(2);
  });

  it("工具配对 ⇒ 跨度为 call→result；isError 透传", () => {
    const m = deriveTrajectoryTimeline([
      ev(1, 100, "assistant/tool_call", { toolCallId: "c1", name: "grep" }),
      ev(2, 700, "tool/result", { toolCallId: "c1", result: "ok" }),
      ev(3, 800, "assistant/tool_call", { toolCallId: "c2", name: "bash" }),
      ev(4, 2000, "tool/result", {
        toolCallId: "c2",
        result: "boom",
        isError: true,
      }),
    ]);

    const toolSpans = m!.spans.filter((s) => s.kind === "tool");
    expect(toolSpans).toHaveLength(2);
    expect(toolSpans[0]).toMatchObject({ id: "tool:c1", isError: false });
    expect(toolSpans[0].end - toolSpans[0].start).toBe(600);
    expect(toolSpans[1]).toMatchObject({ id: "tool:c2", isError: true });
    expect(m!.busyMs).toBe(600 + 1200);
    expect(m!.markersWithoutSpan).toBe(0);
  });

  it("tool/canceled ⇒ 视为错误终止；同一 toolCallId 多终态取最早", () => {
    const m = deriveTrajectoryTimeline([
      ev(1, 100, "assistant/tool_call", { toolCallId: "c1" }),
      ev(2, 500, "tool/canceled", { toolCallId: "c1", reason: "aborted" }),
      ev(3, 900, "tool/result", { toolCallId: "c1", result: "late" }),
    ]);

    expect(m!.spans).toHaveLength(1);
    expect(m!.spans[0].isError).toBe(true);
    expect(m!.spans[0].end).toBe(500); // 取最早终态
  });

  it("标记按时间升序，lane 复用 categorizeEvent 口径", () => {
    const m = deriveTrajectoryTimeline([
      ev(1, 3000, "system/info", { module: "m", message: "x" }),
      ev(2, 1000, "user/message", { content: "hi" }),
      ev(3, 2000, "assistant/tool_call", { toolCallId: "c1" }),
    ]);

    expect(m!.markers.map((x) => x.seq)).toEqual([2, 3, 1]);
    expect(m!.markers.map((x) => x.lane)).toEqual([
      "conversation",
      "tool",
      "system",
    ]);
  });

  it("timeToPercent：域内比例正确，越界钳制在 0-100", () => {
    const domain = { start: 1000, end: 2000 };
    expect(timeToPercent(1000, domain)).toBe(0);
    expect(timeToPercent(1500, domain)).toBe(50);
    expect(timeToPercent(2000, domain)).toBe(100);
    expect(timeToPercent(0, domain)).toBe(0);
    expect(timeToPercent(9999, domain)).toBe(100);
  });

  it("formatDuration：毫秒/秒/分 三档与非法值", () => {
    expect(formatDuration(250)).toBe("250 ms");
    expect(formatDuration(1500)).toBe("1.5 s");
    expect(formatDuration(90_000)).toBe("1 min 30 s");
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(-1)).toBe("—");
  });
});

// ─── P1-4 剩余子项 / P3-4（2026-09-22）：模型耗时与聚合吞吐 ─────────────────

describe("model spans（metric/timing）与聚合吞吐", () => {
  it("回合级 duration ⇒ 区间 [time−duration, time]，并计入 modelMs", () => {
    const m = deriveTrajectoryTimeline([
      ev(1, 1000, "user/message", { content: "hi" }),
      ev(2, 9000, "metric/timing", { stage: "assistant", duration: 4000 }),
    ]);

    expect(m!.modelSpans).toHaveLength(1);
    expect(m!.modelSpans[0]).toEqual({
      seq: 2,
      start: 5000,
      end: 9000,
      duration: 4000,
    });
    expect(m!.modelMs).toBe(4000);
  });

  it("区间起点早于最早事件 time ⇒ domain 向左扩，totalMs 同步", () => {
    const m = deriveTrajectoryTimeline([
      ev(1, 9000, "user/message", { content: "hi" }),
      ev(2, 9000, "metric/timing", { stage: "assistant", duration: 4000 }),
    ]);

    // 全部事件 time 均为 9000（原判定会视为"同一时刻"而返回 null）；
    // 但模型区间 [5000, 9000] 提供了真实跨度 ⇒ 仍应成图。
    expect(m).not.toBeNull();
    expect(m!.domain.start).toBe(5000);
    expect(m!.totalMs).toBe(4000);
  });

  it("吞吐 = ΣoutputTokens / (Σduration/1000)", () => {
    const m = deriveTrajectoryTimeline([
      ev(1, 1000, "user/message", { content: "hi" }),
      ev(2, 3000, "metric/timing", { stage: "request", outputTokens: 300 }),
      ev(3, 5000, "metric/timing", { stage: "request", outputTokens: 100 }),
      ev(4, 7000, "metric/timing", { stage: "assistant", duration: 2000 }),
    ]);

    expect(m!.outputTokens).toBe(400);
    expect(m!.modelMs).toBe(2000);
    expect(m!.throughputTps).toBeCloseTo(200, 6); // (300+100) / 2s
  });

  it("只有 tokens 或只有 duration ⇒ 吞吐 undefined（不拿 0 伪装）", () => {
    const onlyTokens = deriveTrajectoryTimeline([
      ev(1, 1000, "user/message", { content: "hi" }),
      ev(2, 5000, "metric/timing", { stage: "request", outputTokens: 300 }),
    ]);
    expect(onlyTokens!.outputTokens).toBe(300);
    expect(onlyTokens!.throughputTps).toBeUndefined();

    const onlyDuration = deriveTrajectoryTimeline([
      ev(1, 1000, "user/message", { content: "hi" }),
      ev(2, 5000, "metric/timing", { stage: "assistant", duration: 2000 }),
    ]);
    expect(onlyDuration!.modelMs).toBe(2000);
    expect(onlyDuration!.throughputTps).toBeUndefined();
  });

  it("duration ≤ 0 / 非有限 ⇒ 不计入 modelSpans（不伪造区间）", () => {
    const m = deriveTrajectoryTimeline([
      ev(1, 1000, "user/message", { content: "hi" }),
      ev(2, 5000, "metric/timing", { stage: "assistant", duration: 0 }),
      ev(3, 6000, "metric/timing", { stage: "assistant", duration: -100 }),
      ev(4, 7000, "metric/timing", {
        stage: "assistant",
        duration: Number.NaN,
      }),
    ]);

    expect(m!.modelSpans).toHaveLength(0);
    expect(m!.modelMs).toBe(0);
    expect(m!.throughputTps).toBeUndefined();
  });

  it("多个模型区间按 start 升序排列", () => {
    const m = deriveTrajectoryTimeline([
      ev(1, 1000, "user/message", { content: "hi" }),
      ev(2, 9000, "metric/timing", { stage: "assistant", duration: 1000 }), // [8000, 9000]
      ev(3, 5000, "metric/timing", { stage: "assistant", duration: 1000 }), // [4000, 5000]
    ]);

    expect(m!.modelSpans.map((s) => s.start)).toEqual([4000, 8000]);
  });
});

// ─── P1-4 第二步（2026-09-22）：视图窗口数学 ────────────────────────────────

describe("timeline view（缩放 / 平移 / 钳制）", () => {
  const FULL: TimelineView = { start: 0, end: 1000 };

  it("clampTimelineView：越界 ⇒ 平移回界内且**跨度不变**", () => {
    expect(clampTimelineView({ start: -200, end: 300 }, FULL)).toEqual({
      start: 0,
      end: 500,
    });
    expect(clampTimelineView({ start: 800, end: 1500 }, FULL)).toEqual({
      start: 300,
      end: 1000,
    });
  });

  it("clampTimelineView：跨度过小 ⇒ 提升到 minRatio×全跨度；过大 ⇒ 钳到全跨度", () => {
    const tiny = clampTimelineView({ start: 500, end: 500.0001 }, FULL);
    expect(tiny.end - tiny.start).toBeCloseTo(5, 5); // 0.005 × 1000
    expect(clampTimelineView({ start: -50, end: 5000 }, FULL)).toEqual(FULL);
  });

  it("clampTimelineView：全跨度非正 ⇒ 原样返回 full（不产生 NaN / 负跨度）", () => {
    expect(
      clampTimelineView({ start: 5, end: 9 }, { start: 7, end: 7 }),
    ).toEqual({ start: 7, end: 7 });
  });

  it("zoomTimelineView：以锚点为**不动点**放大 ⇒ 相对位置不变", () => {
    const next = zoomTimelineView({ start: 0, end: 1000 }, FULL, 250, 0.5);
    expect(next).not.toBeNull();
    expect(next!.end - next!.start).toBeCloseTo(500, 6);
    // 锚点 250 在新窗口中的相对位置仍是 25%
    expect((250 - next!.start) / (next!.end - next!.start)).toBeCloseTo(
      0.25,
      6,
    );
  });

  it("zoomTimelineView：缩放到全跨度 ⇒ 返回 null（等同未聚焦）", () => {
    expect(zoomTimelineView({ start: 250, end: 750 }, FULL, 500, 2)).toBeNull();
  });

  it("zoomTimelineView：非法 factor ⇒ 原样返回 view", () => {
    const view: TimelineView = { start: 100, end: 400 };
    expect(zoomTimelineView(view, FULL, 200, 0)).toBe(view);
    expect(zoomTimelineView(view, FULL, 200, Number.NaN)).toBe(view);
  });

  it("panTimelineView：同增同减；越界贴齐边界且跨度不变", () => {
    const view: TimelineView = { start: 100, end: 400 };
    expect(panTimelineView(view, FULL, 100)).toEqual({ start: 200, end: 500 });
    expect(panTimelineView(view, FULL, 10_000)).toEqual({
      start: 700,
      end: 1000,
    });
    expect(panTimelineView(view, FULL, -10_000)).toEqual({
      start: 0,
      end: 300,
    });
  });

  it("不变量：连续 缩放/平移 后窗口恒在 full 内、跨度合法", () => {
    const ops: Array<[number, number]> = [
      [900, 0.5],
      [10, 0.5],
      [500, 1.25],
      [999, 0.8],
      [0, 1.25],
      [500, 0.8],
    ];
    let view: TimelineView | null = FULL;
    for (const [anchor, factor] of ops) {
      view = zoomTimelineView(view ?? FULL, FULL, anchor, factor);
      const current: TimelineView = view ?? FULL;
      expect(current.start).toBeGreaterThanOrEqual(FULL.start);
      expect(current.end).toBeLessThanOrEqual(FULL.end);
      expect(current.end).toBeGreaterThan(current.start);
      view = panTimelineView(current, FULL, 137);
    }
    const last = view ?? FULL;
    expect(last.start).toBeGreaterThanOrEqual(FULL.start);
    expect(last.end).toBeLessThanOrEqual(FULL.end);
  });
});
