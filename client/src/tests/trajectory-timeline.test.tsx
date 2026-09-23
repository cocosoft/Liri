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
 * TrajectoryTimeline 组件测试（TC-1，2026-09-23）
 *
 * 补测目标：把该文件 vitest 行覆盖从 **40.33%** 抬起来（此前只有 3 条只读用例）。
 * 本轮补齐**视图交互**（滚轮缩放 / 拖拽选区 / 右键平移 / 重置）与**回调、视图过滤、
 * 模型耗时/吞吐条件分支**。
 *
 * ## 为什么能在 jsdom 里跑几何路径
 *
 * 组件所有"比例 ↔ 时间"换算都经 `trackRef.current.getBoundingClientRect()`；jsdom
 * **无布局** ⇒ rect 恒为全 0 ⇒ `ratioAtClientX` 返回 `null` ⇒ 交互分支全部提前 return。
 * 因此需要交互的用例**显式 stub 轨道容器实例的 `getBoundingClientRect`**（返回非零宽度），
 * 并在 `afterEach` 逐条还原；不 stub 的用例即"几何缺失"场景（用于断言**无效输入不拦截**）。
 *
 * ## 事件注入方式（避免依赖未定义行为）
 *
 * - **滚轮**：组件用**原生** `addEventListener("wheel", …, {passive:false})`（非 React 合成
 *   事件）⇒ 必须向轨道容器派发原生 `WheelEvent`；`cancelable:true` 才能观测 `defaultPrevented`。
 * - **指针**：jsdom 无 `PointerEvent` 构造器 ⇒ 用 `MouseEvent` 构造后把 `pointerId` 定义上去，
 *   再派发到轨道容器（React 按 `event.type` 分发，读的是 `nativeEvent.clientX/button`）。
 *   同时给容器补 `setPointerCapture/releasePointerCapture` 空实现 —— 组件的 `?.()` 已容错，
 *   补上是为了让断言落在**确定性行为**上，而不是 jsdom 的实现细节。
 * - 所有原生派发都包在 `act()` 里，确保 React 状态更新被同步冲洗。
 *
 * ## 夹具原则
 *
 * 事件为**结构合法的 LiriEvent**（seq/time/type/sessionId/data），时间基准固定 `T0`，
 * 不依赖 `Date.now()`；断言只锁**真实派生结果**（文案、元素数、百分比、回调参数）。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TrajectoryTimeline } from "../components/Trajectory/TrajectoryTimeline";
import type { LiriEvent } from "../types";

/** 固定基准时刻（避免 `Date.now()` 让断言漂移） */
const T0 = 1_700_000_000_000;

/** 构造 LiriEvent（时间按 seq 递增 1s，与快照用例同口径） */
function ev(
  seq: number,
  type: LiriEvent["type"],
  data: Record<string, unknown> = {},
  time = T0 + seq * 1000,
): LiriEvent {
  return { seq, time, type, sessionId: "sid-timeline", data } as LiriEvent;
}

/**
 * 场景：一个完整 turn（含工具调用）+ 回合级模型耗时 + 请求级用量 + 一条 turn 外事件。
 *
 * 域 = `[T0+1000, T0+9000]`（跨度 8000ms）；turn 跨度 7000ms；tool 跨度 1000ms；
 * modelSpan = `[T0+3500, T0+6000]`（2500ms）；吞吐 = 500 / 2500ms × 1000 = 200 tok/s。
 * 9 个标记中 4 个参与了配对 ⇒ `markersWithoutSpan = 5`。
 */
const SCENARIO: LiriEvent[] = [
  ev(1, "turn/start", { turn: 1 }),
  ev(2, "user/message", { content: "帮我看看这个文件" }),
  ev(3, "assistant/tool_call", {
    toolCallId: "call-1",
    name: "FileReadTool",
    arguments: { path: "src/app.ts" },
  }),
  ev(4, "tool/result", { toolCallId: "call-1", result: { ok: true } }),
  ev(5, "assistant/text", { content: "读完了" }),
  ev(6, "metric/timing", { stage: "assistant", duration: 2500 }),
  ev(7, "metric/timing", { stage: "request", outputTokens: 500 }),
  ev(8, "turn/end", { turn: 1, finishReason: "stop" }),
  ev(9, "system/info", { message: "外部事件" }),
];

/** 无 `metric/timing` ⇒ `modelMs = 0` 且 `throughputTps === undefined`（两个条件分支的"假"侧） */
const NO_METRIC: LiriEvent[] = [
  ev(1, "turn/start", { turn: 1 }),
  ev(2, "user/message", { content: "hi" }),
  ev(3, "turn/end", { turn: 1 }),
];

/** 只有请求级用量、没有回合级 duration ⇒ 吞吐**不产出**（不拿 0 伪装） */
const REQUEST_ONLY: LiriEvent[] = [
  ev(1, "turn/start", { turn: 1 }),
  ev(2, "metric/timing", { stage: "request", outputTokens: 900 }),
  ev(3, "turn/end", { turn: 1 }),
];

/**
 * P2-2（2026-09-23）请求边界场景：一次**完整**请求（延迟条 + 用量条归并）
 * + 一次**无完成**请求（中断 ⇒ 不画区间，不造长度）。
 */
const REQUEST_SCENARIO: LiriEvent[] = [
  ev(1, "turn/start", { turn: 1 }),
  ev(2, "request/start", { turn: 1, model: "m-1", reason: "chat" }),
  ev(3, "metric/timing", {
    stage: "request",
    ttfb: 100,
    ttft: 120,
    requestId: 2,
  }),
  ev(4, "metric/timing", { stage: "request", tokens: 300, requestId: 2 }),
  ev(5, "request/start", { model: "m-1", reason: "compaction" }),
  ev(6, "turn/end", { turn: 1 }),
];

// ─── 几何 stub ────────────────────────────────────────────────
// 只 stub **轨道容器实例**（不污染 Element.prototype），afterEach 逆序还原。
type RectPatch = { el: Element; orig: () => DOMRect };
const rectPatches: RectPatch[] = [];

/** 把轨道容器的 rect 固定为 `width × height`（左/上为 0，便于手算比例） */
function stubTrackRect(el: Element, width: number, height = 60): void {
  const orig = el.getBoundingClientRect.bind(el);
  rectPatches.push({ el, orig });
  el.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    }) as DOMRect;
}

afterEach(() => {
  while (rectPatches.length > 0) {
    const patch = rectPatches.pop();
    if (patch) patch.el.getBoundingClientRect = patch.orig;
  }
});

// ─── 事件注入 ────────────────────────────────────────────────

function dispatchNative(el: Element, evt: Event): void {
  act(() => {
    el.dispatchEvent(evt);
  });
}

/** 原生 wheel（组件在容器上手动 addEventListener，非 React 合成事件） */
function wheelOn(el: Element, clientX: number, deltaY: number): WheelEvent {
  const evt = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX,
    deltaY,
  });
  dispatchNative(el, evt);
  return evt;
}

/** 原生 pointer（jsdom 无 PointerEvent ⇒ 用 MouseEvent + 补 pointerId） */
function pointerOn(
  el: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  clientX: number,
  button = 0,
): MouseEvent {
  const evt = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    button,
  });
  Object.defineProperty(evt, "pointerId", { value: 1 });
  el.setPointerCapture = () => {};
  el.releasePointerCapture = () => {};
  dispatchNative(el, evt);
  return evt;
}

// ─── 查询辅助 ────────────────────────────────────────────────

/** 轨道容器：根 div 内 `className` 含 `touch-none` 的那一个（挂了全部指针/滚轮交互） */
function getTrack(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(".touch-none");
  if (!el) throw new Error("未找到轨道容器（.touch-none）");
  return el;
}

function renderTimeline(
  events: LiriEvent[],
  opts: { selectedSeq?: number | null } = {},
) {
  return render(
    <TrajectoryTimeline
      events={events}
      selectedSeq={opts.selectedSeq ?? null}
      onSelect={() => {}}
    />,
  );
}

/** 拖动中的选区临时元素（组件给它的 class 含 `bg-amber-400/20`） */
function selectOverlay(container: HTMLElement): Element | null {
  return container.querySelector('[class*="bg-amber-400/20"]');
}

/** 事件位置标记（title 形如 `#3 assistant/tool_call`） */
function markerEls(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('[role="button"][title^="#"]'));
}

/** 配对跨度（title 形如 `轮次 turn:1 · 7.0 s` / `工具 tool:call-1 · 1.0 s`） */
function spanEls(container: HTMLElement): Element[] {
  return Array.from(
    container.querySelectorAll(
      '[role="button"][title^="轮次"], [role="button"][title^="工具"]',
    ),
  );
}

/** 模型耗时条（title 形如 `模型耗时 2.5 s`） */
function modelSpanEls(container: HTMLElement): Element[] {
  return Array.from(
    container.querySelectorAll('[role="button"][title^="模型耗时"]'),
  );
}

/** 请求区间条（title 形如 `请求 R#1 · 2.0 s`；P2-2） */
function requestSpanEls(container: HTMLElement): Element[] {
  return Array.from(
    container.querySelectorAll('[role="button"][title^="请求 R#"]'),
  );
}

// ══════════════════════════════════════════════════════════════
// 1. 降级与只读渲染
// ══════════════════════════════════════════════════════════════

describe("TrajectoryTimeline — 降级与只读渲染", () => {
  // 用例 1
  it("无事件 ⇒ 渲染降级条（不硬凑一张图）", () => {
    const { container } = renderTimeline([]);
    expect(screen.getByText(/时间线不可用/)).toBeDefined();
    // 降级分支不渲染轨道容器（无几何元素可交互）
    expect(getTrackOrNull(container)).toBeNull();
  });

  it("时间域退化（全部同一时刻且无模型区间）⇒ 同样降级", () => {
    renderTimeline([
      ev(1, "turn/start", { turn: 1 }, T0),
      ev(2, "turn/end", { turn: 1 }, T0),
    ]);
    expect(screen.getByText(/时间线不可用/)).toBeDefined();
  });

  // 用例 2
  it("正常渲染：header 统计 / 4 条轨图例 / 标记·跨度·模型耗时条数量", () => {
    const { container } = renderTimeline(SCENARIO);

    // header：标题 + 总跨度（8000ms）+ 跨度合计（turn 7000 + tool 1000）
    expect(screen.getByText("时间线（只读）")).toBeDefined();
    expect(screen.getByText(/总跨度 8\.0 s/)).toBeDefined();
    expect(screen.getByText(/跨度合计 8\.0 s/)).toBeDefined();

    // 4 条轨图例（对话 / 模型耗时 / 工具 / 系统）
    expect(screen.getByText("对话")).toBeDefined();
    expect(screen.getByText("模型耗时")).toBeDefined();
    expect(screen.getByText("工具")).toBeDefined();
    expect(screen.getByText("系统")).toBeDefined();

    // 标记 9 个；配对跨度 2 个（turn + tool）；模型耗时条 1 个
    expect(markerEls(container)).toHaveLength(9);
    expect(spanEls(container)).toHaveLength(2);
    expect(modelSpanEls(container)).toHaveLength(1);

    // 真实文案：跨度标题含 id 与真实墙钟差
    expect(screen.getByTitle(/轮次 turn:1 · 7\.0 s/)).toBeDefined();
    expect(screen.getByTitle(/工具 tool:call-1 · 1\.0 s/)).toBeDefined();
    expect(screen.getByTitle(/^模型耗时 2\.5 s/)).toBeDefined();

    // 如实说明"只有位置、无耗时"的事件数（9 - 4 = 5）
    expect(screen.getByText(/另有\s*5\s*个事件只有时间位置/)).toBeDefined();
  });
});

function getTrackOrNull(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(".touch-none");
}

// ══════════════════════════════════════════════════════════════
// 3~5. 滚轮缩放
// ══════════════════════════════════════════════════════════════

describe("TrajectoryTimeline — 滚轮缩放", () => {
  // 用例 3
  it("放大：拦截默认滚动 + 出现聚焦文案与重置按钮；点重置回到全时间域", () => {
    const { container } = renderTimeline(SCENARIO);
    stubTrackRect(getTrack(container), 400);

    const evt = wheelOn(getTrack(container), 200, -100);
    expect(evt.defaultPrevented).toBe(true);
    expect(screen.getByText(/已聚焦/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "重置视图" }));
    expect(screen.queryByText(/已聚焦/)).toBeNull();
    expect(screen.queryByRole("button", { name: "重置视图" })).toBeNull();
  });

  it("放大后再缩小回全跨度 ⇒ 视图回到全时间域（zoomOut 分支）", () => {
    const { container } = renderTimeline(SCENARIO);
    const track = getTrack(container);
    stubTrackRect(track, 400);

    wheelOn(track, 200, -100); // 8000 → 6400
    expect(screen.getByText(/已聚焦/)).toBeDefined();

    const out = wheelOn(track, 200, 100); // 6400 × 1.25 = 8000 = 全跨度
    expect(out.defaultPrevented).toBe(true);
    expect(screen.queryByText(/已聚焦/)).toBeNull();
  });

  // 用例 4
  it("无效输入不拦截：几何缺失（rect 宽 0）⇒ 不 preventDefault 且不进入聚焦", () => {
    const { container } = renderTimeline(SCENARIO);
    // 不 stub ⇒ jsdom 无布局，rect.width === 0 ⇒ ratioAtClientX 返回 null
    const evt = wheelOn(getTrack(container), 200, -100);
    expect(evt.defaultPrevented).toBe(false);
    expect(screen.queryByText(/已聚焦/)).toBeNull();
  });

  // 用例 4 补充（**TB-8 回归**，2026-09-23）：未聚焦时向下滚轮 ⇒ 结果仍是全时间域
  // ⇒ `zoomTimelineView` 返回 `null`。修复前拿 `null === current`（`current` 是 `fullDomain` 对象）
  // 比较**恒为 false** ⇒ 既 `preventDefault()` 吞掉页面滚动、又没有任何视觉变化（滚动陷阱）。
  // 判据：视图不变（无"已聚焦"）**且不拦截**默认滚动。
  it("未聚焦 + 向下滚轮：窗口没真的变化 ⇒ 不拦截默认滚动（TB-8 回归）", () => {
    const { container } = renderTimeline(SCENARIO);
    stubTrackRect(getTrack(container), 400);

    const evt = wheelOn(getTrack(container), 200, 100); // deltaY > 0 ⇒ 缩小；全时间域下已无法再缩
    expect(evt.defaultPrevented).toBe(false);
    expect(screen.queryByText(/已聚焦/)).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════
// 6~7. 拖拽选区 / 点击判别
// ══════════════════════════════════════════════════════════════

describe("TrajectoryTimeline — 拖拽选区与点击判别", () => {
  // 用例 5
  it("拖拽选区：拖动中出现选区临时元素，松开后按起止比例聚焦", () => {
    const { container } = renderTimeline(SCENARIO);
    const track = getTrack(container);
    stubTrackRect(track, 400);

    pointerOn(track, "pointerdown", 100, 0); // 比例 0.25
    pointerOn(track, "pointermove", 300); // 比例 0.75
    expect(selectOverlay(container)).not.toBeNull();

    pointerOn(track, "pointerup", 300);
    expect(selectOverlay(container)).toBeNull();
    expect(screen.getByText(/已聚焦/)).toBeDefined();
  });

  // 用例 6
  it("位移 ≤ 3px 视为点击：不改视图（定位交给 onClick）", () => {
    const { container } = renderTimeline(SCENARIO);
    const track = getTrack(container);
    stubTrackRect(track, 400);

    pointerOn(track, "pointerdown", 100, 0);
    pointerOn(track, "pointerup", 101); // 位移 1px
    expect(screen.queryByText(/已聚焦/)).toBeNull();

    // pointercancel 与 pointerup 同一处理器（取消也不应改视图）
    pointerOn(track, "pointerdown", 100, 0);
    pointerOn(track, "pointercancel", 300);
    expect(screen.queryByText(/已聚焦/)).toBeNull();
  });

  it("起止比例重合（越界钳制到同一值）⇒ 不设视图", () => {
    const { container } = renderTimeline(SCENARIO);
    const track = getTrack(container);
    stubTrackRect(track, 400);

    pointerOn(track, "pointerdown", 500, 0); // 越界 ⇒ 比例钳到 1
    pointerOn(track, "pointermove", 600); // 仍为 1，位移 > 3px ⇒ moved
    pointerOn(track, "pointerup", 600); // hi === lo ⇒ 不设视图
    expect(screen.queryByText(/已聚焦/)).toBeNull();
  });

  it("几何缺失 + 非左键：pointerdown/move/up 均安全退化为无操作", () => {
    const { container } = renderTimeline(SCENARIO);
    const track = getTrack(container);
    // 不 stub ⇒ rect 全 0

    pointerOn(track, "pointermove", 200); // 无拖拽上下文 ⇒ 直接返回
    pointerOn(track, "pointerup", 200);

    pointerOn(track, "pointerdown", 10, 1); // 中键 ⇒ 既非选区也非平移
    pointerOn(track, "pointerdown", 10, 0); // 左键但几何缺失 ⇒ 不设选区
    expect(selectOverlay(container)).toBeNull();

    pointerOn(track, "pointermove", 300); // 选区：比例解析为 null ⇒ 返回
    pointerOn(track, "pointerup", 300); // r1 为 null ⇒ 返回
    expect(screen.queryByText(/已聚焦/)).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════
// 8. 右键平移
// ══════════════════════════════════════════════════════════════

describe("TrajectoryTimeline — 右键平移", () => {
  // 用例 7
  it("已聚焦时右键拖动 ⇒ 时间窗平移（标记百分比随之变化）", () => {
    const { container } = renderTimeline(SCENARIO);
    const track = getTrack(container);
    stubTrackRect(track, 400);

    wheelOn(track, 200, -100); // 先聚焦：[1800, 8200]
    const before = screen.getByTitle(/^#5 /).style.left;

    pointerOn(track, "pointerdown", 300, 2); // 右键起拖
    pointerOn(track, "pointermove", 100); // 向左拖 ⇒ 时间窗向后
    pointerOn(track, "pointerup", 100);

    const after = screen.getByTitle(/^#5 /).style.left;
    expect(after).not.toBe(before);
    // 已聚焦态保持（平移不重置聚焦）
    expect(screen.getByText(/已聚焦/)).toBeDefined();
  });

  it("未聚焦时右键按下不启动平移（全时间域下平移无意义）", () => {
    const { container } = renderTimeline(SCENARIO);
    const track = getTrack(container);
    stubTrackRect(track, 400);

    const before = screen.getByTitle(/^#5 /).style.left;
    pointerOn(track, "pointerdown", 300, 2);
    pointerOn(track, "pointermove", 100);
    pointerOn(track, "pointerup", 100);

    expect(screen.getByTitle(/^#5 /).style.left).toBe(before);
    expect(screen.queryByText(/已聚焦/)).toBeNull();
  });

  it("平移途中几何缺失 ⇒ 不改变视图", () => {
    const { container } = renderTimeline(SCENARIO);
    const track = getTrack(container);
    stubTrackRect(track, 400);
    wheelOn(track, 200, -100); // 聚焦

    const before = screen.getByTitle(/^#5 /).style.left;
    pointerOn(track, "pointerdown", 300, 2);
    stubTrackRect(track, 0); // 移动前几何失效
    pointerOn(track, "pointermove", 100);
    pointerOn(track, "pointerup", 100);

    expect(screen.getByTitle(/^#5 /).style.left).toBe(before);
  });

  // 用例 8
  it("onContextMenu ⇒ 阻止默认右键菜单", () => {
    const { container } = renderTimeline(SCENARIO);
    const evt = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    dispatchNative(getTrack(container), evt);
    expect(evt.defaultPrevented).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════
// 9~11. 回调 / 视图过滤 / 时间域重置
// ══════════════════════════════════════════════════════════════

describe("TrajectoryTimeline — 回调与视图过滤", () => {
  // 用例 9
  it("标记点击回调：未选中传 seq，已选中传 null（切换分支）", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <TrajectoryTimeline
        events={SCENARIO}
        selectedSeq={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTitle(/^#3 /));
    expect(onSelect).toHaveBeenLastCalledWith(3);

    rerender(
      <TrajectoryTimeline
        events={SCENARIO}
        selectedSeq={3}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTitle(/^#3 /));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("跨度点击回调：传起始 seq，已选中则传 null", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <TrajectoryTimeline
        events={SCENARIO}
        selectedSeq={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTitle(/turn:1/));
    expect(onSelect).toHaveBeenLastCalledWith(1);

    rerender(
      <TrajectoryTimeline
        events={SCENARIO}
        selectedSeq={1}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTitle(/turn:1/));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("模型耗时条点击回调：传该回合 seq，已选中则传 null", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <TrajectoryTimeline
        events={SCENARIO}
        selectedSeq={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTitle(/^模型耗时/));
    expect(onSelect).toHaveBeenLastCalledWith(6);

    rerender(
      <TrajectoryTimeline
        events={SCENARIO}
        selectedSeq={6}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTitle(/^模型耗时/));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  // 用例 10
  it("聚焦态：窗口外的标记被过滤、跨度/模型条不渲染（部分重叠仍保留）", () => {
    const { container } = renderTimeline(SCENARIO);
    const track = getTrack(container);
    stubTrackRect(track, 400);

    // 选区 [6000, 9000]（比例 0.625 → 1）
    pointerOn(track, "pointerdown", 250, 0);
    pointerOn(track, "pointermove", 400);
    pointerOn(track, "pointerup", 400);
    expect(screen.getByText(/已聚焦/)).toBeDefined();

    // 窗口外标记（seq1 = T0+1000）被过滤；窗口内（seq6 = T0+6000）保留
    expect(screen.queryByTitle(/^#1 /)).toBeNull();
    expect(screen.getByTitle(/^#6 /)).toBeDefined();

    // 完全在窗口外的跨度/模型条不渲染
    expect(screen.queryByTitle(/tool:call-1/)).toBeNull();
    expect(screen.queryByTitle(/^模型耗时/)).toBeNull();
    // turn 跨度与窗口部分重叠 ⇒ 仍渲染（靠百分比自然截断）
    expect(screen.getByTitle(/turn:1/)).toBeDefined();
  });

  // 用例 11
  it("传入新 events（时间域变化）⇒ 聚焦态被重置", () => {
    const { container, rerender } = render(
      <TrajectoryTimeline
        events={SCENARIO}
        selectedSeq={null}
        onSelect={() => {}}
      />,
    );
    const track = getTrack(container);
    stubTrackRect(track, 400);
    wheelOn(track, 200, -100);
    expect(screen.getByText(/已聚焦/)).toBeDefined();

    const shifted = SCENARIO.map((e) => ({ ...e, time: e.time + 100_000 }));
    rerender(
      <TrajectoryTimeline
        events={shifted}
        selectedSeq={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByText(/已聚焦/)).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════
// 12. 模型耗时 / 吞吐条件分支
// ══════════════════════════════════════════════════════════════

describe("TrajectoryTimeline — 模型耗时与吞吐条件分支", () => {
  // 用例 12
  it("modelMs > 0 且吞吐可用 ⇒ 两处统计都显示（真实数值）", () => {
    renderTimeline(SCENARIO);
    expect(screen.getByText(/模型合计 2\.5 s/)).toBeDefined();
    // 500 tokens / 2500ms × 1000 = 200.0 tok/s
    expect(screen.getByText(/吞吐 200\.0 tok\/s/)).toBeDefined();
  });

  it("无 metric/timing ⇒ 两处统计都不显示（不拿 0 伪装）", () => {
    renderTimeline(NO_METRIC);
    expect(screen.queryByText(/模型合计/)).toBeNull();
    expect(screen.queryByText(/吞吐/)).toBeNull();
  });

  it("只有请求级用量（无回合级 duration）⇒ 吞吐同样不显示", () => {
    renderTimeline(REQUEST_ONLY);
    expect(screen.queryByText(/模型合计/)).toBeNull();
    expect(screen.queryByText(/吞吐/)).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════
// 13. 请求区间轨（P2-2，2026-09-23）
// ══════════════════════════════════════════════════════════════

describe("TrajectoryTimeline — 请求区间轨（P2-2）", () => {
  it("有 request/start + 完成事件 ⇒ 画请求条；无完成的那个**不画**（区间两端须齐全）", () => {
    const { container } = renderTimeline(REQUEST_SCENARIO);

    // 图例多出「请求」轨（既有 4 条轨不变）
    expect(screen.getByText("请求")).toBeDefined();
    expect(screen.getByText("模型耗时")).toBeDefined();

    // 只有 R#1 有完成（R#2 是 compaction 中断请求）⇒ 只画 1 条
    const bars = requestSpanEls(container);
    expect(bars).toHaveLength(1);
    expect(screen.queryByTitle(/请求 R#2/)).toBeNull();

    // 区间 = [request/start.time, 最早完成事件 time] = 1000ms（真实墙钟差）
    expect(screen.getByTitle(/请求 R#1 · 1\.0 s/)).toBeDefined();
  });

  it("请求条点击回调：传 request/start 的 seq，已选中则传 null", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <TrajectoryTimeline
        events={REQUEST_SCENARIO}
        selectedSeq={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTitle(/请求 R#1/));
    expect(onSelect).toHaveBeenLastCalledWith(2);

    rerender(
      <TrajectoryTimeline
        events={REQUEST_SCENARIO}
        selectedSeq={2}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTitle(/请求 R#1/));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});
