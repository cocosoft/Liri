// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * deriveTrajectoryTimeline —— 轨迹时间线只读投影（P1-4 第一步，2026-09-22）
 *
 * 对标：deepseek-harness 的 Overview（记录表上方的时间轴，可拖动区间聚焦）。
 * 本步**只做只读时间条**（交互拖选/缩放属第二 步，本轮不做）。
 *
 * **只绘制真实数据（不做任何虚构）** —— 当前事件流里没有任何"每条记录的耗时"字段：
 * - `metric/timing` 事件**在本仓无生产者**（全仓检索仅命中类型定义与注册表）⇒ 不可依赖；
 * - `tool/result` 载荷**不含耗时**。
 *
 * 因此本模块只用两类**真实**时间事实：
 * 1. **配对跨度（span）**：由起止事件的**真实墙钟时间差**得出 —— 这是"哪一步慢"的直接答案
 *    - `turn/start → turn/end`（按 `data.turn` 配对）
 *    - `assistant/tool_call → tool/result | tool/canceled`（按 `toolCallId` 配对）
 * 2. **标记（marker）**：每个事件的 `time` 位置（**只表示位置，不表示长度**）
 *
 * 输出里用 `markersWithoutSpan` 显式告诉 UI "有多少事件只有位置、没有长度"，
 * 便于向用户如实说明（而不是把标记画成等宽条冒充耗时）。
 */

import type { LiriEvent, LiriEventCategory, LiriEventType } from "@/types";
import { categorizeEvent } from "@/types";
// P2-7（2026-09-22）：关联编号统一读取（与 `deriveTrajectoryLayout` 同口径，避免两处校验漂移）
import { readTurnNo } from "./deriveTrajectoryLayout";

/** 参与跨度的轨道（只用事件原生分类，不引入第二套分类口径） */
export type TrajectorySpanKind = "turn" | "tool";

export interface TrajectoryTimelineSpan {
  kind: TrajectorySpanKind;
  /** 稳定标识：`turn:<n>` / `tool:<toolCallId>` */
  id: string;
  /** 起止事件的 seq（点击定位用；取起始事件） */
  startSeq: number;
  /** 起止事件 seq（结束事件，便于跳转） */
  endSeq: number;
  /** epoch ms */
  start: number;
  end: number;
  /** 错误终止（工具失败/取消） */
  isError: boolean;
}

export interface TrajectoryTimelineMarker {
  seq: number;
  time: number;
  lane: LiriEventCategory;
  type: LiriEventType;
}

export interface TrajectoryTimelineModel {
  /** 可见窗口时间域（用于按比例定位） */
  domain: { start: number; end: number };
  spans: TrajectoryTimelineSpan[];
  markers: TrajectoryTimelineMarker[];
  /** 总跨度毫秒（end - start） */
  totalMs: number;
  /** 跨度合计毫秒（可用来对比"忙 vs 空档"） */
  busyMs: number;
  /**
   * **只有位置、没有长度**的事件数（= 未参与任何配对跨度的事件）。
   * UI 应据此如实说明，而不是把标记渲染成等长条冒充耗时。
   */
  markersWithoutSpan: number;
  /**
   * 模型耗时区间（P1-4 剩余子项 / P3-4，2026-09-22）—— 来自 `metric/timing` 事件
   * **回合级**（`stage === 'assistant'`）的 `duration`（真实墙钟 = `createdAt − startedAt`）。
   *
   * 区间取 `[time − duration, time]`：事件 `time` 是**回合完成时刻**（消息落盘时写入），
   * 故向前推 `duration` 即回到该回合的流式起点 —— 与 `startedAt → createdAt` 语义一致。
   */
  modelSpans: TrajectoryModelSpan[];
  /** 模型耗时合计 ms（Σ `modelSpans[].duration`） */
  modelMs: number;
  /** 输出 tokens 合计（Σ 请求级 `outputTokens`，来自 `metric/timing` 的 `stage='request'`） */
  outputTokens: number;
  /**
   * 聚合吞吐（输出 tok/s）= `outputTokens / (modelMs / 1000)`。
   *
   * **口径（如实说明）**：这是**窗口内聚合**速率（分母只累加模型实际工作时间 —— 回合级
   * duration 之和），**不是**单次请求的瞬时解码速率；两侧任一为 0/缺失时**不产出**
   * （`undefined`，不拿 0 伪装）。
   */
  throughputTps?: number;
}

/**
 * 模型耗时区间（来自 `metric/timing` 回合级 `duration`）。
 *
 * 注：与 `TrajectoryTimelineSpan`（turn / 工具**配对跨度**）**粒度不同、并列展示**：
 * 一个回合可能包含多次工具调用与多轮 LLM 请求，故 model span 可与 turn span 重叠。
 */
export interface TrajectoryModelSpan {
  /** 事件 seq（点击定位用） */
  seq: number;
  /** 区间起点 = `time − duration` */
  start: number;
  /** 区间终点 = 事件 `time`（回合完成时刻） */
  end: number;
  /** 该回合耗时 ms（= `end − start`） */
  duration: number;
}

/**
 * 事件为空 / 时间域退化（全部同一时刻且无模型区间）⇒ 无法成图，返回 null。
 *
 * **复杂度（P3-3，2026-09-22）**：时间 `O(E log E)` —— 主因是配对后按时间排序
 * （`spans` / `modelSpans`）；空间 `O(S + M)`（跨度数 + 模型区间数），均 `= O(E)`。
 */
export function deriveTrajectoryTimeline(
  events: readonly LiriEvent[],
): TrajectoryTimelineModel | null {
  if (events.length === 0) return null;

  let minTime = Number.POSITIVE_INFINITY;
  let maxTime = Number.NEGATIVE_INFINITY;
  for (const e of events) {
    if (!Number.isFinite(e.time)) continue;
    if (e.time < minTime) minTime = e.time;
    if (e.time > maxTime) maxTime = e.time;
  }
  if (!Number.isFinite(minTime) || !Number.isFinite(maxTime)) return null;

  // ── 模型耗时与吞吐（P1-4 剩余子项 / P3-4，2026-09-22）──
  // 数据源：`metric/timing`（TR-14 已接生产者）。**只取事件自带字段**：
  // 回合级 `duration`（有 duration 无 tokens）、请求级 `outputTokens`（有 tokens 无 duration）
  // ⇒ 吞吐用"两侧聚合"计算，不把任一方的缺失伪装成 0。
  //
  // 位置说明：必须在**时间域退化判定之前**解析 —— 回合区间 `[time−duration, time]` 的起点
  // 可能早于全部事件的 `time`，此时它是"唯一的时间跨度来源"（如一场会话只落了 metric/timing）。
  const modelSpans: TrajectoryModelSpan[] = [];
  let outputTokens = 0;
  for (const e of events) {
    if (e.type !== "metric/timing") continue;
    const d = e.data as {
      stage?: string;
      duration?: number;
      outputTokens?: number;
    };
    if (d.stage === "assistant") {
      if (
        typeof d.duration === "number" &&
        Number.isFinite(d.duration) &&
        d.duration > 0
      ) {
        modelSpans.push({
          seq: e.seq,
          start: e.time - d.duration,
          end: e.time,
          duration: d.duration,
        });
      }
    } else if (d.stage === "request") {
      if (
        typeof d.outputTokens === "number" &&
        Number.isFinite(d.outputTokens)
      ) {
        outputTokens += d.outputTokens;
      }
    }
  }
  modelSpans.sort((a, b) => a.start - b.start || a.seq - b.seq);
  const modelMs = modelSpans.reduce((sum, m) => sum + m.duration, 0);
  const throughputTps =
    modelMs > 0 && outputTokens > 0
      ? (outputTokens / modelMs) * 1000
      : undefined;

  // 模型区间可能早于最早事件的 `time`（回合起点在"完成时刻"之前）⇒ 扩域，避免被钳到左边界
  const minModelStart = modelSpans.reduce(
    (min, m) => Math.min(min, m.start),
    Number.POSITIVE_INFINITY,
  );
  const domainStart = Number.isFinite(minModelStart)
    ? Math.min(minTime, minModelStart)
    : minTime;

  if (maxTime <= domainStart) return null; // 单点/同一时刻且无模型区间：时间线无意义

  const spans: TrajectoryTimelineSpan[] = [];
  /** 参与跨度的事件 seq（用于算 markersWithoutSpan） */
  const spanned = new Set<number>();

  // ── 跨度①：turn（按 turn 编号配对，取首次出现） ──
  const turnStarts = new Map<number, LiriEvent>();
  const turnEnds = new Map<number, LiriEvent>();
  for (const e of events) {
    // P2-7（2026-09-22）：关联编号统一走 `readTurnNo`（非法/缺失 ⇒ **跳过配对**，
    // 即"忽略该记录"而非合入 `undefined`）。行为与原有 `typeof` 校验一致，仅口径归一。
    if (e.type === "turn/start") {
      const turn = readTurnNo((e.data as { turn?: unknown }).turn);
      if (turn !== undefined && !turnStarts.has(turn)) {
        turnStarts.set(turn, e);
      }
    } else if (e.type === "turn/end") {
      const turn = readTurnNo((e.data as { turn?: unknown }).turn);
      if (turn !== undefined && !turnEnds.has(turn)) {
        turnEnds.set(turn, e);
      }
    }
  }
  for (const [turn, startEvent] of turnStarts) {
    const endEvent = turnEnds.get(turn);
    if (!endEvent || endEvent.time < startEvent.time) continue;
    spans.push({
      kind: "turn",
      id: `turn:${turn}`,
      startSeq: startEvent.seq,
      endSeq: endEvent.seq,
      start: startEvent.time,
      end: endEvent.time,
      isError: false,
    });
    spanned.add(startEvent.seq);
    spanned.add(endEvent.seq);
  }

  // ── 跨度②：工具调用（按 toolCallId 配对） ──
  const toolCalls = new Map<string, LiriEvent>();
  const toolEnds = new Map<string, { event: LiriEvent; isError: boolean }>();
  for (const e of events) {
    if (e.type === "assistant/tool_call") {
      const id = (e.data as { toolCallId?: string }).toolCallId;
      if (typeof id === "string" && id && !toolCalls.has(id)) {
        toolCalls.set(id, e);
      }
    } else if (e.type === "tool/result" || e.type === "tool/canceled") {
      const id = (e.data as { toolCallId?: string }).toolCallId;
      if (typeof id !== "string" || !id) continue;
      const isError =
        e.type === "tool/canceled" ||
        (e.data as { isError?: boolean }).isError === true;
      const prev = toolEnds.get(id);
      // 同一 toolCallId 出现多个终态时，取**最早**的终态（首个结束即区间终点）
      if (!prev || e.time < prev.event.time) {
        toolEnds.set(id, { event: e, isError });
      }
    }
  }
  for (const [id, startEvent] of toolCalls) {
    const end = toolEnds.get(id);
    if (!end || end.event.time < startEvent.time) continue;
    spans.push({
      kind: "tool",
      id: `tool:${id}`,
      startSeq: startEvent.seq,
      endSeq: end.event.seq,
      start: startEvent.time,
      end: end.event.time,
      isError: end.isError,
    });
    spanned.add(startEvent.seq);
    spanned.add(end.event.seq);
  }

  spans.sort((a, b) => a.start - b.start || a.startSeq - b.startSeq);

  const markers: TrajectoryTimelineMarker[] = events
    .filter((e) => Number.isFinite(e.time))
    .map((e) => ({
      seq: e.seq,
      time: e.time,
      lane: categorizeEvent(e.type),
      type: e.type,
    }))
    .sort((a, b) => a.time - b.time || a.seq - b.seq);

  const busyMs = spans.reduce((sum, s) => sum + (s.end - s.start), 0);

  return {
    domain: { start: domainStart, end: maxTime },
    spans,
    markers,
    totalMs: maxTime - domainStart,
    busyMs,
    markersWithoutSpan: markers.filter((m) => !spanned.has(m.seq)).length,
    modelSpans,
    modelMs,
    outputTokens,
    throughputTps,
  };
}

/** 把时刻投影为容器内百分比（0-100，钳制在域内） */
export function timeToPercent(
  time: number,
  domain: { start: number; end: number },
): number {
  const span = domain.end - domain.start;
  if (span <= 0) return 0;
  const pct = ((time - domain.start) / span) * 100;
  return Math.min(100, Math.max(0, pct));
}

/** 人类可读的毫秒（用于标题与统计） */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m} min ${s} s`;
}

// ─── P1-4 第二步（2026-09-22）：视图窗口数学 ─────────────────────────────────
// **复杂度（P3-3）**：`clampTimelineView` / `zoomTimelineView` / `panTimelineView` 与
// `timeToPercent` 均为 **O(1)**（纯算术；无遍历、无与输入规模相关的分配）。
// 刻意抽成**纯函数**（组件只做事件接线）：缩放/平移/钳制的正确性可单测，
// 不必依赖 jsdom 的（不可靠的）布局测量。

/** 时间线视图窗口（epoch ms 区间） */
export interface TimelineView {
  start: number;
  end: number;
}

/** 最小可视跨度占全跨度的比例（防止缩放到 0 宽度） */
export const MIN_VIEW_RATIO = 0.005;

/**
 * 把视图窗口**钳制**在完整时间域内，并保证跨度 ∈ `[minRatio×全跨度, 全跨度]`。
 *
 * 不变量：返回值恒满足 `full.start <= start < end <= full.end`。
 */
export function clampTimelineView(
  view: TimelineView,
  full: TimelineView,
  minRatio: number = MIN_VIEW_RATIO,
): TimelineView {
  const fullSpan = full.end - full.start;
  if (!(fullSpan > 0)) return { start: full.start, end: full.end };
  const span = Math.min(
    fullSpan,
    Math.max(fullSpan * minRatio, view.end - view.start),
  );
  let start = view.start;
  if (start < full.start) start = full.start;
  if (start + span > full.end) start = full.end - span;
  return { start, end: start + span };
}

/**
 * 以 `anchorTime` 为**固定点**缩放（该时刻在窗口内的相对位置保持不变）。
 *
 * @param factor `>1` 缩小（看更多）、`<1` 放大；非法值原样返回 `view`
 * @returns 缩放后的窗口；若已等价于全时间域，返回 `null`（="未聚焦"，UI 可省去重置入口）
 */
export function zoomTimelineView(
  view: TimelineView,
  full: TimelineView,
  anchorTime: number,
  factor: number,
  minRatio: number = MIN_VIEW_RATIO,
): TimelineView | null {
  const span = view.end - view.start;
  if (!(span > 0) || !Number.isFinite(factor) || factor <= 0) return view;
  const ratio = Math.min(1, Math.max(0, (anchorTime - view.start) / span));
  const nextSpan = span * factor;
  const rawStart = anchorTime - ratio * nextSpan;
  const next = clampTimelineView(
    { start: rawStart, end: rawStart + nextSpan },
    full,
    minRatio,
  );
  const fullSpan = full.end - full.start;
  return next.end - next.start >= fullSpan ? null : next;
}

/** 平移视图（`deltaMs > 0` 向后），并钳制在完整域内 */
export function panTimelineView(
  view: TimelineView,
  full: TimelineView,
  deltaMs: number,
): TimelineView {
  return clampTimelineView(
    { start: view.start + deltaMs, end: view.end + deltaMs },
    full,
  );
}
