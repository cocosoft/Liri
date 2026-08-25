/**
 * ChatInspector — 对话信息面板（主组件）
 *
 * Tab 容器 + 收起/展开 + 拖拽调整宽度 + 键盘快捷键。
 * 嵌入 ChatPageLayout 内部，仅聊天页渲染。
 */

import React from "react";
import { useCallback, useRef, useEffect, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useChatInspectorStore } from "../../stores/chatInspectorStore";
import type { InspectorTab } from "../../stores/chatInspectorStore";
import ContextTab from "./ContextTab";
import FilesTab from "./FilesTab";
import SettingsTab from "./SettingsTab";
import { useSessionStore } from "../../stores/sessionStore";
import { useTrajectoryStore } from "../../stores/chat/trajectoryStore";
import { TrajectoryFilter } from "../Trajectory/TrajectoryFilter";
import { TrajectoryRow } from "../Trajectory/TrajectoryRow";
import { TrajectoryDetail } from "../Trajectory/TrajectoryDetail";
import { TrajectoryPlayer } from "../Trajectory/TrajectoryPlayer";
import LogTab from "./LogTab";
import type { LiriEvent } from "../../types";
import { categorizeEvent } from "../../types";
import { trajectoryService } from "../../services/trajectoryService";
import {
  deriveTrajectoryLayout,
  flattenLayout,
} from "../../stores/chat/deriveTrajectoryLayout";

// ─── 配置 ─────────────────────────────────────────

// P7（2026-08-25）：来源维度派生映射（对标 DSH 按来源查看，复用 categorizeEvent 而非新加枚举）
const CATEGORY_TO_SOURCE: Record<string, string> = {
  conversation: "llm",
  tool: "tool",
  context: "system",
  system: "system",
  channel: "channel",
  lifecycle: "system",
};

function categoryToSource(category: string): string {
  return CATEGORY_TO_SOURCE[category] ?? "system";
}

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

function CollapsedBarImpl({
  onExpandAndSwitch,
}: {
  onExpandAndSwitch: (tab: InspectorTab) => void;
}) {
  const activeToolCount = useChatInspectorStore((s) => s.activeToolCount);
  const newFileCount = useChatInspectorStore((s) => s.newFileCount);
  const tokenWarning = useChatInspectorStore((s) => s.tokenWarning);

  return (
    <div className="w-12 flex flex-col items-center py-2 gap-2 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700">
      {TABS.map((tab) => {
        const badge =
          tab.id === "trajectory" && activeToolCount > 0
            ? `${activeToolCount}`
            : tab.id === "files" && newFileCount > 0
              ? `+${newFileCount}`
              : tab.id === "context" && tokenWarning
                ? "!"
                : null;
        return (
          <button
            key={tab.id}
            onClick={() => onExpandAndSwitch(tab.id)}
            className="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            title={`展开到${tab.label} Tab`}
          >
            {tab.icon}
            {badge && (
              <span
                className={`absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white rounded-full ${
                  tab.id === "context"
                    ? "bg-red-500"
                    : tab.id === "trajectory"
                      ? "bg-blue-500 animate-pulse"
                      : "bg-green-500"
                }`}
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
const CollapsedBar = React.memo(CollapsedBarImpl);

/** 内嵌版轨迹面板（放在 ChatInspector Tab 里的版本，不带外层独立抽屉壳） */
function TrajectoryTabContentImpl() {
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
    hasMore,
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

  // 会话切换 → 重新加载该会话的事件流
  useEffect(() => {
    if (sessionId) {
      loadEvents(sessionId);
    }
  }, [sessionId, loadEvents]);

  // 过滤后的事件（按 category/type/关键字过滤）
  const filteredEvents = useMemo(() => {
    let result: LiriEvent[] = events;
    if (filter.categories.length > 0) {
      const set = new Set(filter.categories);
      result = result.filter((e) => set.has(categorizeEvent(e.type)));
    }
    if (filter.types.length > 0) {
      const set = new Set(filter.types);
      result = result.filter((e) => set.has(e.type));
    }
    // P7（2026-08-25）：来源过滤（categorizeEvent → source 派生映射）
    if (filter.sources.length > 0) {
      const set = new Set(filter.sources);
      result = result.filter((e) =>
        set.has(categoryToSource(categorizeEvent(e.type))),
      );
    }
    // P7（2026-08-25）：seq / 时间区间过滤
    if (filter.minSeq !== undefined)
      result = result.filter((e) => e.seq >= filter.minSeq!);
    if (filter.maxSeq !== undefined)
      result = result.filter((e) => e.seq <= filter.maxSeq!);
    if (filter.fromTime !== undefined)
      result = result.filter((e) => e.time >= filter.fromTime!);
    if (filter.toTime !== undefined)
      result = result.filter((e) => e.time <= filter.toTime!);
    if (filter.keyword.trim()) {
      const kw = filter.keyword.trim().toLowerCase();
      result = result.filter((e) => {
        const data = e.data as Record<string, unknown>;
        const candidates = [
          typeof data.content === "string" ? data.content : "",
          typeof data.name === "string" ? data.name : "",
          typeof data.error === "string" ? data.error : "",
          typeof data.message === "string" ? data.message : "",
          typeof data.result === "string" ? data.result : "",
          typeof data.toolCallId === "string" ? data.toolCallId : "",
          typeof data.turn === "number" || typeof data.turn === "string"
            ? String(data.turn)
            : "",
          typeof data.model === "string" ? data.model : "",
        ];
        return candidates.some((c) => c.toLowerCase().includes(kw));
      });
    }
    return result;
  }, [events, filter]);

  const selectedEvent = useMemo(() => {
    if (selectedSeq === null) return null;
    return events.find((e) => e.seq === selectedSeq) ?? null;
  }, [events, selectedSeq]);

  // R-1（2026-08-23）：轨迹 Tab 按 Turn/Step 分组渲染（恢复规格书 E-2 交付物），
  // 孤立事件（session/start 等）单独列出
  const layout = useMemo(
    () => deriveTrajectoryLayout(filteredEvents),
    [filteredEvents],
  );

  // P1（2026-08-25）：轨迹 Tab 虚拟滚动——layout 拍平为行列表，Turn 头作为独立 virtual item
  const flatRows = useMemo(() => flattenLayout(layout), [layout]);
  const flatParentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => flatParentRef.current,
    estimateSize: () => 40,
    overscan: 8,
    getItemKey: (index) => flatRows[index]?.key ?? index,
  });

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
        还没有选中会话。
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 flex items-center justify-between">
        <span>
          {filteredEvents.length}/{events.length} 条 · tailSeq={liveTailSeq}
        </span>
        {/* P7：导出事件（jsonl） */}
        <button
          onClick={() => sessionId && trajectoryService.exportEvents(sessionId)}
          disabled={!sessionId || events.length === 0}
          className="px-2 py-0.5 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
          title="导出事件为 JSONL"
        >
          导出事件
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
      />
      <TrajectoryFilter filter={filter} onChange={setFilter} />
      <div ref={flatParentRef} className="flex-1 overflow-y-auto">
        {loading && events.length === 0 ? (
          <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
            加载中...
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-red-600 dark:text-red-400">
            加载失败：{error}
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
            {events.length === 0 ? "暂无事件" : "无匹配事件"}
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
                    /* Turn 分组头（P1：独立 virtual item，不再使用 sticky） */
                    <div className="px-3 py-1.5 text-[11px] flex items-center gap-2 bg-gray-50/80 dark:bg-gray-900/80 border-b border-gray-100 dark:border-gray-800">
                      <span className="font-semibold text-blue-600 dark:text-blue-400">
                        Turn {row.turn.turn}
                      </span>
                      <span className="text-gray-400">
                        seq {row.turn.startSeq}-{row.turn.endSeq} ·{" "}
                        {row.turn.eventCount} 事件
                      </span>
                      {row.turn.completed ? (
                        <span className="text-green-600 dark:text-green-400">
                          已完成
                        </span>
                      ) : row.turn.interrupted ? (
                        <span className="text-orange-500">已中断</span>
                      ) : (
                        <span className="text-amber-500">进行中</span>
                      )}
                    </div>
                  ) : (
                    <TrajectoryRow
                      event={row.event}
                      selected={
                        row.event.seq === selectedSeq ||
                        vi.index === playbackIndex
                      }
                      onClick={() =>
                        selectEvent(
                          row.event.seq === selectedSeq ? null : row.event.seq,
                        )
                      }
                    />
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
              加载更多
            </button>
          </div>
        )}
      </div>
      {selectedEvent && (
        <TrajectoryDetail
          event={selectedEvent}
          onClose={() => selectEvent(null)}
        />
      )}
    </div>
  );
}
const TrajectoryTabContent = React.memo(TrajectoryTabContentImpl);

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
    return <CollapsedBar onExpandAndSwitch={handleExpandAndSwitch} />;

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
