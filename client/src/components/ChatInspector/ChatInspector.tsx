/**
 * ChatInspector — 对话信息面板（主组件）
 *
 * Tab 容器 + 收起/展开 + 拖拽调整宽度 + 键盘快捷键。
 * 嵌入 ChatPageLayout 内部，仅聊天页渲染。
 */

import React from "react";
import {
  useCallback,
  useRef,
  useEffect,
  useMemo,
  useDeferredValue,
} from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useChatInspectorStore } from "../../stores/chatInspectorStore";
import type { InspectorTab } from "../../stores/chatInspectorStore";
import ContextTab from "./ContextTab";
// FSZ-161（2026-09-23）：收起态标签条与「请求指标」分区抽至同目录独立文件
import CollapsedBar from "./CollapsedBar";
import ApiMetricsSection from "./ApiMetricsSection";
import FilesTab from "./FilesTab";
import SettingsTab from "./SettingsTab";
import { useSessionStore } from "../../stores/sessionStore";
import { useTrajectoryStore } from "../../stores/chat/trajectoryStore";
import { TrajectoryFilter } from "../Trajectory/TrajectoryFilter";
import { TrajectoryRow } from "../Trajectory/TrajectoryRow";
import TrajectoryDetail from "../Trajectory/TrajectoryDetail";
import { TrajectoryTimeline } from "../Trajectory/TrajectoryTimeline";
import { TrajectoryPlayer } from "../Trajectory/TrajectoryPlayer";
import LogTab from "./LogTab";
// P1-5（2026-09-22）：`LiriEvent` / `categorizeEvent` 的导入随过滤逻辑抽取而移除
//（现仅在 `stores/chat/filterTrajectoryEvents.ts` 中使用）
import { trajectoryService } from "../../services/trajectoryService";
import {
  deriveTrajectoryLayout,
  filterCollapsedTurns,
  flattenLayout,
} from "../../stores/chat/deriveTrajectoryLayout";
import { filterTrajectoryEvents } from "../../stores/chat/filterTrajectoryEvents";
// FSZ-161（2026-09-23）：`deriveApiMetrics` / `ApiMetricsPercentiles` / `formatDuration`
// 随 `ApiMetricsSection` 抽离而移出本文件（其导入现只在 `./ApiMetricsSection.tsx`）
// P2-2（2026-09-23）：请求边界 —— turn 头呈现该轮覆盖的请求编号 `R#n`
import { deriveRequestSpans } from "../../stores/chat/deriveRequestSpans";
import { useCollapsedTurns } from "../../hooks/useCollapsedTurns";

// ─── 配置 ─────────────────────────────────────────

// P1-5（2026-09-22）：来源维度派生映射（`categoryToSource`）与事件过滤逻辑统一移入
// `stores/chat/filterTrajectoryEvents.ts`（纯函数，可单测），此处不再保留副本。

const TABS: { id: InspectorTab; icon: React.ReactNode; label: string }[] = [
  {
    id: "context",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
        <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6z" />
        <path d="M10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
      </svg>
    ),
    label: "上下文",
  },
  {
    id: "trajectory",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
          clipRule="evenodd"
        />
      </svg>
    ),
    label: "轨迹",
  },
  {
    id: "files",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
          clipRule="evenodd"
        />
      </svg>
    ),
    label: "文件",
  },
  {
    id: "log",
    // R-3 挂载（2026-08-23）：会话日志面板（LogTab）——从事件流构建的
    // AI 思考/工具调用/系统事件时间轴
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
        <path d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" />
        <path d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" />
        <path d="M3 15a1 1 0 011-1h8a1 1 0 110 2H4a1 1 0 01-1-1z" />
      </svg>
    ),
    label: "日志",
  },
  {
    id: "settings",
    // FIX(2026-08-23)：① 手写 cog SVG 的 arc flag 在部分浏览器报 "Expected arc flag"；
    // ② lucide-react 1.25.0 无 Settings 导出（SettingsIcon is not defined）。
    // 改用无 arc 命令的简化齿轮（同心圆 + 辐条），纯几何元素无解析歧义。
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
        <circle cx="10" cy="10" r="3" />
        <circle
          cx="10"
          cy="10"
          r="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path
          d="M10 1v3M10 16v3M1 10h3M16 10h3"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
    ),
    label: "设置",
  },
];

// ─── 子组件 ───────────────────────────────────────

// （`CollapsedBar` 已于 FSZ-161（2026-09-23）抽至 `./CollapsedBar.tsx`；
//   标签表仍以本文件的 `TABS` 为单一来源，经 `tabs` 入参传入）

/** 内嵌版轨迹面板（放在 ChatInspector Tab 里的版本，不带外层独立抽屉壳） */
function TrajectoryTabContentImpl() {
  const { t } = useTranslation();
  const currentSession = useSessionStore((s) => s.currentSession);
  const sessionId = currentSession?.id ?? null;

  const {
    events,
    liveTailSeq,
    loading,
    error,
    selectedSeq,
    filter,
    loadEvents,
    loadMore,
    loadOlder,
    hasMore,
    hasEarlier,
    selectEvent,
    setFilter,
    playing,
    playbackSpeed,
    playbackIndex,
    togglePlay,
    setPlaybackSpeed,
    seekPlayback,
    advancePlayback,
  } = useTrajectoryStore();

  // ── P1-1（2026-09-22）向前补页：滚动锚定 ──────────────────────────────
  // 补页会**前插**一段更早记录 ⇒ 容器 scrollHeight 变大，若不动 scrollTop，用户视野会
  // 被"推走"。故：发起前记录 (scrollHeight, scrollTop)，补页落地后按高度差补偿
  // scrollTop，使用户仍停留在原来那条记录上（对齐 deepseek-harness 的 prepend 锚定）。
  const olderAnchorRef = useRef<{
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);

  const handleLoadOlder = useCallback(() => {
    const el = flatParentRef.current;
    if (!el || olderAnchorRef.current) return;
    olderAnchorRef.current = {
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
    };
    void loadOlder();
  }, [loadOlder]);

  /** 顶部哨兵：滚动接近顶部（≤80px）时自动补页（受 hasEarlier / loading 双重守卫） */
  const handleTrajectoryScroll = useCallback(() => {
    const el = flatParentRef.current;
    if (!el || !hasEarlier || loading) return;
    if (el.scrollTop <= 80) handleLoadOlder();
  }, [handleLoadOlder, hasEarlier, loading]);

  // 补页落地后补偿滚动位置（等虚拟化器测量完成，避免用旧高度计算）
  useEffect(() => {
    const anchor = olderAnchorRef.current;
    if (!anchor) return;
    const el = flatParentRef.current;
    if (!el) {
      olderAnchorRef.current = null;
      return;
    }
    const raf = requestAnimationFrame(() => {
      el.scrollTop = anchor.scrollTop + (el.scrollHeight - anchor.scrollHeight);
      olderAnchorRef.current = null;
    });
    return () => cancelAnimationFrame(raf);
  }, [events.length]);

  // P1-6（2026-09-22）：Turn 级折叠 —— **状态机制与日志 Tab 共用同一 hook**（归一化：
  // 此前折叠只在 LogTab 存在，轨迹 Tab 没有）。声明位置需在下方会话切换 effect 之前
  //（该 effect 会 clear，避免 TDZ）。
  const {
    collapsedTurns,
    toggleTurn,
    isCollapsed,
    clear: clearCollapsedTurns,
  } = useCollapsedTurns();

  // 会话切换 → 重新加载该会话的事件流（并丢弃上一会话遗留的补页锚点与折叠态）
  useEffect(() => {
    olderAnchorRef.current = null;
    clearCollapsedTurns(); // P1-6：turn 序号属会话内语义，跨会话沿用会错折叠
    if (sessionId) {
      loadEvents(sessionId);
    }
  }, [sessionId, loadEvents, clearCollapsedTurns]);

  // 过滤后的事件（按 category/type/来源/seq/时间/关键字过滤）
  //
  // P1-5（2026-09-22）节流：**关键字用延迟值参与过滤** —— 输入框保持即时响应（`filter.keyword`
  // 照常即时回显），而"过滤 → 布局派生 → 虚拟列表重建"这条随事件数线性变重的链路降为
  // 低优先级渲染。
  //
  // 关键实现细节：**不能把整个 `filter` 对象作为依赖**，否则每次按键都会在紧急渲染里重算
  // memo（拿到的还是旧的延迟关键字 ⇒ 纯属浪费且照样阻塞输入）。故此处**解构出离散维度**
  //（点击类筛选，非逐键）作为依赖，只有 keyword 走 `deferredKeyword`。
  const {
    categories: filterCategories,
    types: filterTypes,
    sources: filterSources,
    minSeq: filterMinSeq,
    maxSeq: filterMaxSeq,
    fromTime: filterFromTime,
    toTime: filterToTime,
  } = filter;
  const deferredKeyword = useDeferredValue(filter.keyword);
  const filteredEvents = useMemo(
    () =>
      filterTrajectoryEvents(events, {
        categories: filterCategories,
        types: filterTypes,
        sources: filterSources,
        minSeq: filterMinSeq,
        maxSeq: filterMaxSeq,
        fromTime: filterFromTime,
        toTime: filterToTime,
        keyword: deferredKeyword,
      }),
    [
      events,
      filterCategories,
      filterTypes,
      filterSources,
      filterMinSeq,
      filterMaxSeq,
      filterFromTime,
      filterToTime,
      deferredKeyword,
    ],
  );

  // R-1（2026-08-23）：轨迹 Tab 按 Turn/Step 分组渲染（恢复规格书 E-2 交付物），
  // 孤立事件（session/start 等）单独列出
  const layout = useMemo(
    () => deriveTrajectoryLayout(filteredEvents),
    [filteredEvents],
  );

  // P1（2026-08-25）：轨迹 Tab 虚拟滚动——layout 拍平为行列表，Turn 头作为独立 virtual item
  // P1-6（2026-09-22）：Turn 级折叠 —— **状态机制与日志 Tab 共用同一 hook**（归一化：
  // 此前折叠只在 LogTab 存在，轨迹 Tab 没有），过滤走纯函数 `filterCollapsedTurns`
  //（turn 头保留、被折叠 turn 的事件行跳过）。下游 `flatRows` 引用保持不变（最小改动）。
  const allRows = useMemo(() => flattenLayout(layout), [layout]);

  /**
   * P2-2（2026-09-23）：turn 头呈现的请求编号区间（`R#n`）。
   *
   * 归属判据：`request/start` 的 seq 落在该 turn 的 `[startSeq, endSeq]` 内（**用事件自身
   * 的 seq 区间**，不靠标题/文案推断）⇒ 与列表同源（过滤后事件），不会与过滤视图串味。
   * 无请求的 turn ⇒ 不显示（不占位）。compaction 请求标记为该轮"含压缩"。
   */
  const requestsByTurn = useMemo(() => {
    const spans = deriveRequestSpans(filteredEvents);
    const byTurn = new Map<
      number,
      { first: number; last: number; compaction: boolean }
    >();
    for (const turn of layout.turns) {
      let first = 0;
      let last = 0;
      let compaction = false;
      for (const r of spans) {
        if (r.startSeq < turn.startSeq || r.startSeq > turn.endSeq) continue;
        if (first === 0) first = r.index;
        last = r.index;
        if (r.reason === "compaction") compaction = true;
      }
      if (first > 0) byTurn.set(turn.turn, { first, last, compaction });
    }
    return byTurn;
  }, [filteredEvents, layout.turns]);

  const flatRows = useMemo(
    () => filterCollapsedTurns(allRows, collapsedTurns),
    [allRows, collapsedTurns],
  );

  // TB-6（2026-09-23，方案 B）：详情浮层的数据源 —— 由 `selectedSeq` 反查事件对象。
  // 之所以要它：详情已移出"行内/滚动流"，改由面板级浮层渲染 ⇒ 需要独立拿到被选事件。
  const selectedEvent = useMemo(
    () =>
      selectedSeq == null
        ? null
        : (events.find((e) => e.seq === selectedSeq) ?? null),
    [events, selectedSeq],
  );

  const flatParentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => flatParentRef.current,
    estimateSize: () => 40,
    overscan: 8,
    getItemKey: (index) => flatRows[index]?.key ?? index,
  });

  // P6：turn 边界（turn-header 行的拍平行 index 列表），供 ⏮/⏭ 跳转定位
  const turnIndexes = useMemo(
    () =>
      flatRows.reduce<number[]>((acc, row, i) => {
        if (row.kind === "turn-header") acc.push(i);
        return acc;
      }, []),
    [flatRows],
  );

  // P6：跳转上一个/下一个 turn 边界（按 turn-header 行 index 定位）
  const jumpTurn = useCallback(
    (dir: -1 | 1) => {
      const cur = playbackIndex;
      const target =
        dir === -1
          ? [...turnIndexes].reverse().find((i) => i < cur)
          : turnIndexes.find((i) => i > cur);
      if (target !== undefined) {
        seekPlayback(target);
      }
    },
    [turnIndexes, playbackIndex, seekPlayback],
  );

  // P6（2026-08-25）：回放播放定时器——按 speed 倍率推进一行（简化固定间隔）
  useEffect(() => {
    if (!playing || flatRows.length === 0) return;
    const timer = setInterval(
      () => {
        advancePlayback(flatRows.length);
      },
      Math.max(200, 600 / playbackSpeed),
    );
    return () => clearInterval(timer);
  }, [playing, playbackSpeed, flatRows.length, advancePlayback]);

  if (!sessionId) {
    return (
      <div className="p-6 text-sm text-gray-500 dark:text-gray-400 text-center">
        {t("trajectory.list.noSession")}
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-full overflow-hidden">
      <div className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 flex items-center justify-between">
        <span>
          {t("trajectory.header.count", {
            shown: filteredEvents.length,
            total: events.length,
            tailSeq: liveTailSeq,
          })}
        </span>
        {/* P7：导出事件（jsonl） */}
        <button
          onClick={() => sessionId && trajectoryService.exportEvents(sessionId)}
          disabled={!sessionId || events.length === 0}
          className="px-2 py-0.5 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
          title={t("trajectory.header.exportTitle")}
        >
          {t("trajectory.header.export")}
        </button>
      </div>
      <TrajectoryPlayer
        totalRows={flatRows.length}
        playing={playing}
        playbackSpeed={playbackSpeed}
        playbackIndex={playbackIndex}
        onToggle={togglePlay}
        onSpeed={setPlaybackSpeed}
        onSeek={seekPlayback}
        onPrevTurn={() => jumpTurn(-1)}
        onNextTurn={() => jumpTurn(1)}
      />
      <TrajectoryFilter filter={filter} onChange={setFilter} />
      {/* P1-4（2026-09-22）只读时间线：与列表使用**同一份过滤后事件**（口径一致） */}
      <TrajectoryTimeline
        events={filteredEvents}
        selectedSeq={selectedSeq}
        onSelect={selectEvent}
      />
      {/* API 指标展示（2026-09-23）：请求级聚合分区 —— 时间线之下、事件列表之上，
          与过滤后事件同源（口径与时间线/列表一致） */}
      <ApiMetricsSection events={filteredEvents} />
      <div
        ref={flatParentRef}
        className="flex-1 overflow-y-auto"
        onScroll={handleTrajectoryScroll}
      >
        {/* P1-1（2026-09-22）：向前补页入口（仅当后端 hasEarlier 为真时出现；
            滚动到顶部也会自动触发，见 handleTrajectoryScroll） */}
        {hasEarlier && (
          <div className="p-2 text-center">
            <button
              onClick={handleLoadOlder}
              disabled={loading}
              className="px-3 py-1.5 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded disabled:opacity-40 disabled:cursor-not-allowed"
              title={t("trajectory.list.loadOlderTitle")}
            >
              {loading
                ? t("trajectory.list.loading")
                : t("trajectory.list.loadOlder")}
            </button>
          </div>
        )}
        {loading && events.length === 0 ? (
          <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
            {t("trajectory.list.loading")}
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-red-600 dark:text-red-400">
            {t("trajectory.list.loadError", { error })}
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
            {events.length === 0
              ? t("trajectory.list.noEvents")
              : t("trajectory.list.noMatch")}
          </div>
        ) : (
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const row = flatRows[vi.index];
              if (!row) return null;
              // P2-2：本 turn 覆盖的请求编号（无请求 / 非 turn 头 ⇒ undefined，不占位）
              const rq =
                row.kind === "turn-header"
                  ? requestsByTurn.get(row.turn.turn)
                  : undefined;
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  {row.kind === "turn-header" ? (
                    /* Turn 分组头（P1：独立 virtual item，不再使用 sticky）
                       P1-6（2026-09-22）：整行作为折叠开关（点击折叠/展开该 turn 的事件行） */
                    <button
                      type="button"
                      onClick={() => toggleTurn(row.turn.turn)}
                      className="w-full px-3 py-1.5 text-[11px] flex items-center gap-2 text-left bg-gray-50/80 dark:bg-gray-900/80 border-b border-gray-100 dark:border-gray-800"
                    >
                      <span className="font-semibold text-blue-600 dark:text-blue-400">
                        Turn {row.turn.turn}
                      </span>
                      <span className="text-gray-400">
                        {t("trajectory.turn.meta", {
                          start: row.turn.startSeq,
                          end: row.turn.endSeq,
                          count: row.turn.eventCount,
                        })}
                      </span>
                      {row.turn.completed ? (
                        <span className="text-green-600 dark:text-green-400">
                          {t("trajectory.turn.completed")}
                        </span>
                      ) : row.turn.interrupted ? (
                        <span className="text-orange-500">
                          {t("trajectory.turn.interrupted")}
                        </span>
                      ) : (
                        <span className="text-amber-500">
                          {t("trajectory.turn.running")}
                        </span>
                      )}
                      {/* P2-2（2026-09-23）：本轮覆盖的请求编号（R#n；compaction 带标记） */}
                      {rq && (
                        <span className="text-orange-600 dark:text-orange-400">
                          {t("trajectory.turn.requestRange", {
                            range:
                              rq.first === rq.last
                                ? `R#${rq.first}`
                                : `R#${rq.first}~R#${rq.last}`,
                            compaction: rq.compaction
                              ? t("trajectory.turn.requestCompaction")
                              : "",
                          })}
                        </span>
                      )}
                      <span className="ml-auto text-gray-400 dark:text-gray-500 shrink-0">
                        {isCollapsed(row.turn.turn)
                          ? t("trajectory.turn.expand")
                          : t("trajectory.turn.collapse")}
                      </span>
                    </button>
                  ) : (
                    <>
                      <TrajectoryRow
                        event={row.event}
                        selected={
                          row.event.seq === selectedSeq ||
                          vi.index === playbackIndex
                        }
                        onClick={() =>
                          selectEvent(
                            row.event.seq === selectedSeq
                              ? null
                              : row.event.seq,
                          )
                        }
                      />
                      {/* TB-6（2026-09-23）：详情**不再行内展开**（见本组件末尾的浮层渲染）。
                          行内展开会把详情高度并入"滚动内容高度"，实测展开时浏览器内部会把
                          `scrollTop` 同步 +Δ（无任何 JS 参与，`overflow-anchor: none` 亦无效）
                          ⇒ 列表整体下滚、被点行随之上移出视口。故改为移出滚动内容流。 */}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {hasMore && !loading && (
          <div className="p-3 text-center">
            <button
              onClick={loadMore}
              className="px-3 py-1.5 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded"
            >
              {t("trajectory.list.loadMore")}
            </button>
          </div>
        )}
      </div>
      {/* TB-6（2026-09-23，方案 B 根治）：详情以**绝对定位浮层**覆盖在列表下沿 —— 移出滚动内容流。
          为什么：实测（探针打桩 `scrollTop` setter + `scrollTo/scrollBy/scrollIntoView/focus` +
          容器 `scroll`/`ResizeObserver`，真实鼠标点击）证明"展开详情 ⇒ 内容高度 +Δ ⇒ `scrollTop` 被
          浏览器内部同步 +Δ"这条路**完全无 JS 参与**，且 `overflow-anchor: none` 无效。既然无法关掉
          该内部行为，就消除触发条件：浮层不参与滚动内容高度 ⇒ 高度零变化 ⇒ 既不出现"展开即下滚"，也
          不出现"详情挤压列表 ⇒ clientHeight 变小 ⇒ scrollTop 被钳制"（曾实测 −633px）。
          外层 `pointer-events-none`：浮层空白区不挡住列表点击；详情自身已设 `pointer-events-auto`。
          详情内部的 `max-h-[50%]` 仍生效 —— 其包含块是本浮层（`inset-0`，高度确定）⇒ 上限为面板高度一半。 */}
      <div className="absolute inset-0 z-10 flex flex-col justify-end pointer-events-none">
        {selectedEvent && (
          <TrajectoryDetail
            event={selectedEvent}
            onClose={() => selectEvent(null)}
            allEvents={events}
          />
        )}
      </div>
    </div>
  );
}
const TrajectoryTabContent = React.memo(TrajectoryTabContentImpl);

// （`ApiMetricsSection` 已于 FSZ-161（2026-09-23）抽至 `./ApiMetricsSection.tsx`：
//   位置/双态/刻意不展示的指标等说明随组件一并迁移；调用点不变）

function TabContentImpl({ tabId }: { tabId: InspectorTab }) {
  switch (tabId) {
    case "context":
      return <ContextTab />;
    case "trajectory":
      return <TrajectoryTabContent />;
    case "files":
      return <FilesTab />;
    case "log":
      return <LogTab />;
    case "settings":
      return <SettingsTab />;
  }
}
const TabContent = React.memo(TabContentImpl);

// ─── 主组件 ───────────────────────────────────────

function ChatInspector() {
  const isOpen = useChatInspectorStore((s) => s.isOpen);
  const activeTab = useChatInspectorStore((s) => s.activeTab);
  const panelWidth = useChatInspectorStore((s) => s.panelWidth);
  const setOpen = useChatInspectorStore((s) => s.setOpen);
  const setActiveTab = useChatInspectorStore((s) => s.setActiveTab);
  const setPanelWidth = useChatInspectorStore((s) => s.setPanelWidth);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // 小屏 (<1024px) 自动收起
  useEffect(() => {
    const BREAKPOINT = 1024;
    function handleResize() {
      if (window.innerWidth < BREAKPOINT && isOpen) {
        setOpen(false);
      }
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isOpen, setOpen]);

  // Ctrl+1~4 切换 Tab, Ctrl+` 切换展开/收起
  useEffect(() => {
    const KEY_MAP: Record<string, InspectorTab> = {
      "1": "context",
      "2": "trajectory",
      "3": "files",
      "4": "settings",
    };
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && KEY_MAP[e.key]) {
        e.preventDefault();
        setActiveTab(KEY_MAP[e.key]);
        if (!isOpen) setOpen(true);
      }
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        setOpen(!isOpen);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, setOpen, setActiveTab]);

  const handleExpandAndSwitch = useCallback(
    (tab: InspectorTab) => {
      setActiveTab(tab);
      setOpen(true);
    },
    [setActiveTab, setOpen],
  );
  const handleTabClick = useCallback(
    (tab: InspectorTab) => {
      setActiveTab(tab);
    },
    [setActiveTab],
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (!isOpen) return;
      e.preventDefault();
      draggingRef.current = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (ev: MouseEvent) => {
        if (!draggingRef.current || !wrapperRef.current) return;
        const parent = wrapperRef.current.parentElement;
        if (!parent) return;
        const rect = parent.getBoundingClientRect();
        setPanelWidth(rect.right - ev.clientX);
      };
      const onUp = () => {
        draggingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [isOpen, setPanelWidth],
  );

  if (!isOpen)
    return (
      <CollapsedBar tabs={TABS} onExpandAndSwitch={handleExpandAndSwitch} />
    );

  return (
    <div
      ref={wrapperRef}
      className="relative flex-shrink-0 h-full bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 flex flex-col transition-all duration-300 ease-in-out overflow-hidden"
      style={{ width: `${panelWidth}px` }}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400/50 active:bg-blue-500/50 transition-colors z-10"
        style={{ marginLeft: -3 }}
        onMouseDown={handleResizeStart}
      />
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab.id)}
            className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-xs transition-colors ${
              activeTab === tab.id
                ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
            title={tab.label}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        <TabContent tabId={activeTab} />
      </div>
      <button
        onClick={() => setOpen(false)}
        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-10 bg-gray-200 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-l-md flex items-center justify-center hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors z-20 shadow-sm"
        style={{ marginLeft: -3 }}
        title="收起面板"
      >
        <svg
          className="w-3 h-3 text-gray-500 dark:text-gray-400"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path
            d="M10.5 3L5.5 8l5 5"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
          />
        </svg>
      </button>
    </div>
  );
}

export default React.memo(ChatInspector);
