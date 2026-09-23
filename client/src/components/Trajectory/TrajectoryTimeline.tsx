// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * TrajectoryTimeline —— 轨迹时间线
 *
 * - **P1-4 第一步（2026-09-22）**：只读时间条（3 轨：对话 / 工具 / 系统）。
 * - **P1-4 第二步（2026-09-22）**：视图交互 —— **拖拽选区聚焦 / 滚轮缩放 / 右键平移**（+ 重置）。
 *
 * 设计要点：
 * 1. **视图数学全在 `deriveTrajectoryTimeline` 的纯函数里**（`clampTimelineView` /
 *    `zoomTimelineView` / `panTimelineView`）⇒ 正确性可单测，组件只做事件接线与像素↔时间换算。
 * 2. **视图是组件内状态**（不改 store、不改事件模型）；**时间域变化即回到全时间域**
 *    （避免"旧的聚焦窗口套在新数据上"—— 切会话 / 向前补页都会改变时间域）。
 * 3. **点击 vs 拖拽**：位移 < 3px 视为点击（交给标记 / 跨度的 onClick 定位），否则才是选区。
 * 4. **右键平移**仅在已聚焦时生效（全时间域下平移无意义），并阻止默认右键菜单。
 * 5. **只画真实数据**（见 `deriveTrajectoryTimeline`）：配对跨度为真实墙钟差；标记只表示位置。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LiriEvent, LiriEventCategory } from "@/types";
import {
  clampTimelineView,
  deriveTrajectoryTimeline,
  formatDuration,
  panTimelineView,
  timeToPercent,
  zoomTimelineView,
  type TimelineView,
  type TrajectorySpanKind,
} from "../../stores/chat/deriveTrajectoryTimeline";

interface Props {
  events: LiriEvent[];
  selectedSeq: number | null;
  onSelect: (seq: number | null) => void;
}

/** marker 用的分类轨道（`laneOf` 只产出这 3 个） */
type Lane = "conversation" | "tool" | "system";
/** **绘制**用的轨道 id（含只画 span、不接收 marker 的 `model` 轨） */
type LaneId = Lane | "model";

function laneOf(category: LiriEventCategory): Lane {
  if (category === "tool") return "tool";
  if (category === "conversation") return "conversation";
  return "system"; // context / system / channel / lifecycle 统一归入"系统"轨
}

const LANES: Array<{ id: LaneId; labelKey: string; bar: string }> = [
  {
    id: "conversation",
    labelKey: "trajectory.category.conversation",
    bar: "bg-blue-400/70 dark:bg-blue-500/70",
  },
  {
    // P1-4 剩余子项 / P3-4（2026-09-22）：模型耗时（`metric/timing` 回合级 duration）
    id: "model",
    labelKey: "trajectory.timeline.laneModel",
    bar: "bg-emerald-400/80 dark:bg-emerald-500/80",
  },
  {
    id: "tool",
    labelKey: "trajectory.category.tool",
    bar: "bg-violet-400/70 dark:bg-violet-500/70",
  },
  {
    id: "system",
    labelKey: "trajectory.category.system",
    bar: "bg-gray-400/60 dark:bg-gray-500/60",
  },
];

/** 配对跨度类型 → 所属轨道（替代原先硬编码的 0/1 下标） */
const SPAN_LANE_ID: Record<TrajectorySpanKind, LaneId> = {
  turn: "conversation",
  tool: "tool",
};

const laneIndexById = (id: LaneId): number =>
  LANES.findIndex((l) => l.id === id);

/** 点击与拖拽的判别阈值（px） */
const DRAG_THRESHOLD_PX = 3;
/** 滚轮缩放步长（`<1` 放大、`>1` 缩小） */
const ZOOM_IN_FACTOR = 0.8;
const ZOOM_OUT_FACTOR = 1.25;

export function TrajectoryTimeline({ events, selectedSeq, onSelect }: Props) {
  const { t } = useTranslation();
  const model = useMemo(() => deriveTrajectoryTimeline(events), [events]);

  const fullDomain: TimelineView | null = model?.domain ?? null;
  /** 视图窗口：`null` = 全时间域（未聚焦） */
  const [view, setView] = useState<TimelineView | null>(null);
  /** 拖拽中的选区（**容器内比例** 0-1，便于直接按百分比渲染） */
  const [selectRect, setSelectRect] = useState<{
    r1: number;
    r2: number;
  } | null>(null);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    kind: "select" | "pan";
    startX: number;
    lastX: number;
    startView: TimelineView;
    moved: boolean;
  } | null>(null);

  const domain = view ?? fullDomain;

  // 时间域变化（切换会话 / 向前补页）⇒ 回到全时间域
  const domainKey = fullDomain ? `${fullDomain.start}:${fullDomain.end}` : "";
  useEffect(() => {
    setView(null);
  }, [domainKey]);

  /** 容器内比例（0-1；越界钳制） */
  const ratioAtClientX = useCallback((clientX: number): number | null => {
    const el = trackRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!(rect.width > 0)) return null;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  /** 比例 → 时间 */
  const timeAtRatio = useCallback(
    (ratio: number, d: TimelineView): number =>
      d.start + ratio * (d.end - d.start),
    [],
  );

  // 滚轮缩放：手动 addEventListener（React 在 root 上挂 wheel 为 passive，无法 preventDefault）
  useEffect(() => {
    const el = trackRef.current;
    if (!el || !fullDomain) return;
    const handler = (e: WheelEvent) => {
      const ratio = ratioAtClientX(e.clientX);
      if (ratio === null) return;
      const current = view ?? fullDomain;
      const anchor = timeAtRatio(ratio, current);
      const factor = e.deltaY > 0 ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR;
      const next = zoomTimelineView(current, fullDomain, anchor, factor);
      // TB-8（2026-09-23 修复）：`null` 的语义是"回到全时间域"，比较前**必须**把它归一化成
      // `fullDomain`。否则未聚焦时向下滚轮（窗口仍是全时间域 ⇒ `zoomTimelineView` 返回 `null`）
      // 会被误判成"窗口有变化" ⇒ 既 `preventDefault()` 吞掉页面滚动、又没有任何视觉变化
      //（实测的滚动陷阱；与本节注释"无效输入 ⇒ 不拦截页面滚动"的意图相悖）。
      if ((next ?? fullDomain) === current) return;
      e.preventDefault();
      setView(next);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [view, fullDomain, ratioAtClientX, timeAtRatio]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!fullDomain || !domain) return;
    const isPan = e.button === 2;
    const isSelect = e.button === 0;
    if (!isPan && !isSelect) return;
    if (isPan && !view) return; // 全时间域下平移无意义
    dragRef.current = {
      kind: isPan ? "pan" : "select",
      startX: e.clientX,
      lastX: e.clientX,
      startView: { ...domain },
      moved: false,
    };
    if (isSelect) {
      const r = ratioAtClientX(e.clientX);
      if (r !== null) setSelectRect({ r1: r, r2: r });
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !fullDomain) return;
    drag.lastX = e.clientX;
    if (Math.abs(e.clientX - drag.startX) > DRAG_THRESHOLD_PX) {
      drag.moved = true;
    }

    if (drag.kind === "select") {
      const r = ratioAtClientX(e.clientX);
      if (r === null) return;
      const startRatio = ratioAtClientX(drag.startX);
      if (startRatio === null) return;
      setSelectRect({ r1: startRatio, r2: r });
      return;
    }

    // 平移：向右拖 ⇒ 时间窗向前（看更早）
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    const span = drag.startView.end - drag.startView.start;
    const deltaMs = -((e.clientX - drag.startX) / rect.width) * span;
    setView(panTimelineView(drag.startView, fullDomain, deltaMs));
  };

  const handlePointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setSelectRect(null);
    if (!drag || !fullDomain || !domain) return;
    if (drag.kind === "pan") return;
    // 位移不足 ⇒ 视为点击，不改视图（定位交给标记 / 跨度的 onClick）
    if (!drag.moved) return;

    const r1 = ratioAtClientX(drag.startX);
    const r2 = ratioAtClientX(drag.lastX);
    if (r1 === null || r2 === null) return;
    const lo = Math.min(r1, r2);
    const hi = Math.max(r1, r2);
    if (!(hi > lo)) return;
    const next = clampTimelineView(
      {
        start: timeAtRatio(lo, domain),
        end: timeAtRatio(hi, domain),
      },
      fullDomain,
    );
    const fullSpan = fullDomain.end - fullDomain.start;
    setView(next.end - next.start >= fullSpan ? null : next);
  };

  if (!model || !domain) {
    return (
      <div className="px-4 py-1.5 text-[11px] text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-800">
        {t("trajectory.timeline.unavailable")}
      </div>
    );
  }

  const {
    spans,
    markers,
    totalMs,
    busyMs,
    markersWithoutSpan,
    modelSpans,
    modelMs,
    throughputTps,
  } = model;

  // 窗口外的**点状标记**不渲染（聚焦后堆在边界反而干扰读数）；
  // 跨度则保留并靠 `timeToPercent` 自然截断显示（部分重叠仍可读）
  const visibleMarkers = view
    ? markers.filter((m) => m.time >= domain.start && m.time <= domain.end)
    : markers;

  return (
    <div className="px-4 pt-2 pb-1 border-b border-gray-100 dark:border-gray-800 bg-white/50 dark:bg-gray-900/30">
      <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400 mb-1">
        <span className="flex items-center gap-2">
          <span>{t("trajectory.timeline.title")}</span>
          <span>
            {t("trajectory.timeline.totalSpan", {
              duration: formatDuration(totalMs),
            })}
          </span>
          <span>
            {t("trajectory.timeline.busySpan", {
              duration: formatDuration(busyMs),
            })}
          </span>
          {/* P3-4：模型耗时合计（仅当有 metric/timing 回合级数据时才显示） */}
          {modelMs > 0 && (
            <span>
              {t("trajectory.timeline.modelMsSpan", {
                duration: formatDuration(modelMs),
              })}
            </span>
          )}
          {/* 聚合吞吐（输出 tok/s）—— 两侧数据齐全才算，缺失不显示（不拿 0 伪装） */}
          {throughputTps !== undefined && (
            <span>
              {t("trajectory.timeline.throughput", {
                value: throughputTps.toFixed(1),
              })}
            </span>
          )}
          {view && (
            <span className="text-amber-600 dark:text-amber-500">
              {t("trajectory.timeline.zoomed", {
                duration: formatDuration(view.end - view.start),
              })}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {view && (
            <button
              type="button"
              onClick={() => setView(null)}
              className="rounded px-1.5 py-0.5 text-amber-600 dark:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/30"
            >
              {t("trajectory.timeline.resetView")}
            </button>
          )}
          {LANES.map((l) => (
            <span key={l.id} className="flex items-center gap-0.5">
              <span className={`inline-block w-2 h-2 rounded-sm ${l.bar}`} />
              {t(l.labelKey)}
            </span>
          ))}
        </span>
      </div>

      <div
        ref={trackRef}
        className="relative select-none touch-none"
        style={{
          height: LANES.length * 14 + 4,
          cursor: view ? "grab" : "crosshair",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        {LANES.map((lane, i) => (
          <div
            key={lane.id}
            className="absolute left-0 right-0 border-t border-dashed border-gray-200/70 dark:border-gray-700/50"
            style={{ top: i * 14 + 7 }}
          />
        ))}

        {/* 拖拽选区（比例 → 百分比） */}
        {selectRect && (
          <div
            className="absolute top-0 bottom-0 bg-amber-400/20 border-x border-amber-500/60 pointer-events-none"
            style={{
              left: `${Math.min(selectRect.r1, selectRect.r2) * 100}%`,
              width: `${Math.abs(selectRect.r2 - selectRect.r1) * 100}%`,
            }}
          />
        )}

        {/* 事件位置标记（只表示"何时发生"，不表示耗时） */}
        {visibleMarkers.map((m) => (
          <div
            key={`m-${m.seq}`}
            role="button"
            tabIndex={-1}
            title={`#${m.seq} ${m.type}`}
            onClick={() => onSelect(m.seq === selectedSeq ? null : m.seq)}
            className={`absolute w-px cursor-pointer ${
              m.seq === selectedSeq
                ? "bg-amber-500"
                : "bg-gray-400/60 dark:bg-gray-500/60 hover:bg-gray-600"
            }`}
            style={{
              left: `${timeToPercent(m.time, domain)}%`,
              top: laneIndexById(laneOf(m.lane)) * 14 + 2,
              height: 10,
            }}
          />
        ))}

        {/* 配对跨度（真实墙钟：turn / 工具调用） */}
        {spans.map((s) => {
          const left = timeToPercent(s.start, domain);
          const right = timeToPercent(s.end, domain);
          if (right <= 0 || left >= 100) return null; // 完全在窗口外 ⇒ 不渲染
          const width = Math.max(0.6, right - left); // 极短跨度保底可见
          const laneIndex = laneIndexById(SPAN_LANE_ID[s.kind]);
          const selected = s.startSeq === selectedSeq;
          return (
            <div
              key={`s-${s.id}`}
              role="button"
              tabIndex={-1}
              title={t("trajectory.timeline.spanTitle", {
                kind:
                  s.kind === "tool"
                    ? t("trajectory.timeline.spanKindTool")
                    : t("trajectory.timeline.spanKindTurn"),
                id: s.id,
                duration: formatDuration(s.end - s.start),
                error: s.isError
                  ? t("trajectory.timeline.spanErrorSuffix")
                  : "",
              })}
              onClick={() => onSelect(selected ? null : s.startSeq)}
              className={`absolute h-2 rounded-sm cursor-pointer ${
                s.isError
                  ? "bg-rose-400/80 dark:bg-rose-500/80"
                  : selected
                    ? "bg-amber-500/90"
                    : LANES[laneIndex].bar
              }`}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                top: laneIndex * 14 + 3,
              }}
            />
          );
        })}

        {/* 模型耗时（`metric/timing` 回合级 duration；区间 = [time−duration, time] 真实墙钟） */}
        {modelSpans.map((m) => {
          const left = timeToPercent(m.start, domain);
          const right = timeToPercent(m.end, domain);
          if (right <= 0 || left >= 100) return null; // 完全在窗口外 ⇒ 不渲染
          const width = Math.max(0.6, right - left);
          const laneIndex = laneIndexById("model");
          const selected = m.seq === selectedSeq;
          return (
            <div
              key={`ms-${m.seq}`}
              role="button"
              tabIndex={-1}
              title={t("trajectory.timeline.modelSpanTitle", {
                duration: formatDuration(m.duration),
              })}
              onClick={() => onSelect(selected ? null : m.seq)}
              className={`absolute h-2 rounded-sm cursor-pointer ${
                selected
                  ? "bg-amber-500/90"
                  : "bg-emerald-400/80 dark:bg-emerald-500/80"
              }`}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                top: laneIndex * 14 + 3,
              }}
            />
          );
        })}
      </div>

      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
        {t("trajectory.timeline.legendLead", { count: markersWithoutSpan })}
        <span className="text-gray-500 dark:text-gray-400">
          {t("trajectory.timeline.legendNoDuration")}
        </span>
        {t("trajectory.timeline.legendTail")}
        <span className="ml-1 text-gray-300 dark:text-gray-600">
          {t("trajectory.timeline.hint")}
        </span>
      </div>
    </div>
  );
}

export default TrajectoryTimeline;
