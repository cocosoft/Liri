/**
 * DayView — 单日日视图（24h 时间轴）
 * 单击空白区域选择时段，双击空白区域添加日程
 */

import { useState, useMemo } from "react";
import type { UnifiedCalendarEvent, EventSource, EventStatus } from "../../../types/office";
import StatusBadge from "./StatusBadge";

/** 事件来源颜色映射 */
const EVENT_COLORS: Record<
  EventSource,
  { bg: string; text: string; border: string }
> = {
  manual: {
    bg: "bg-blue-100 dark:bg-blue-900/60",
    text: "text-blue-700 dark:text-blue-300",
    border: "border-l-blue-500",
  },
  cron: {
    bg: "bg-green-100 dark:bg-green-900/60",
    text: "text-green-700 dark:text-green-300",
    border: "border-l-green-500",
  },
  ai: {
    bg: "bg-purple-100 dark:bg-purple-900/60",
    text: "text-purple-700 dark:text-purple-300",
    border: "border-l-purple-500",
  },
};

/** 完成状态覆盖样式 */
const COMPLETED_STYLE = "opacity-50 line-through";
const OVERDUE_STYLE = "border-l-2 border-l-red-500";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface DayViewProps {
  dateStr: string;
  events: UnifiedCalendarEvent[];
  onBack: () => void;
  onAddEvent: (dateStr: string, startHour?: number) => void;
  onUpdateStatus: (eventId: string, status: EventStatus) => void;
  onDeleteEvent: (eventId: string) => void;
  /** 右键菜单回调 */
  onContextMenu?: (e: React.MouseEvent, event: UnifiedCalendarEvent) => void;
}

export default function DayView({
  dateStr,
  events,
  onBack,
  onAddEvent,
  onUpdateStatus,
  onDeleteEvent,
  onContextMenu,
}: DayViewProps) {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const isToday = dateStr === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  /** 按小时分组的事件（考虑重叠用列布局） */
  const eventsByHour = useMemo(() => {
    const grouped = new Map<number, UnifiedCalendarEvent[]>();
    for (const ev of events) {
      const startHour = ev.time
        ? parseInt(ev.time.split(":")[0], 10)
        : 0;
      if (!grouped.has(startHour)) grouped.set(startHour, []);
      grouped.get(startHour)!.push(ev);
    }
    return grouped;
  }, [events]);

  /** 统计信息 */
  const stats = useMemo(() => {
    const count = { pending: 0, in_progress: 0, completed: 0, cancelled: 0, overdue: 0 };
    for (const ev of events) {
      if (ev.status && ev.status in count) {
        count[ev.status as keyof typeof count]++;
      }
    }
    return count;
  }, [events]);

  /** 格式化日期显示 */
  const dateLabel = (() => {
    const d = new Date(dateStr + "T00:00:00");
    const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
  })();

  /** 点击空白区域 → 添加日程 */
  const handleEmptyClick = (e: React.MouseEvent, hour: number) => {
    // 双击才添加
    if (e.detail === 2) {
      onAddEvent(dateStr, hour);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* 顶部导航栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          返回月视图
        </button>
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          {dateLabel}
          {isToday && (
            <span className="ml-2 text-sm text-blue-500 font-normal">
              今天
            </span>
          )}
        </h2>
        <button
          onClick={() => onAddEvent(dateStr)}
          className="flex items-center gap-1 px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          + 添加日程
        </button>
      </div>

      {/* 24h 时间轴 */}
      <div className="flex-1 overflow-y-auto">
        <div className="relative">
          {HOURS.map((hour) => {
            const hourEvents = eventsByHour.get(hour) ?? [];
            const isCurrentHour = isToday && hour === currentHour;

            return (
              <div
                key={hour}
                className="flex border-b border-gray-100 dark:border-gray-800 min-h-[60px]"
                onClick={(e) => handleEmptyClick(e, hour)}
              >
                {/* 时间轴标签 */}
                <div className="w-16 flex-shrink-0 text-right pr-3 pt-1">
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {String(hour).padStart(2, "0")}:00
                  </span>
                </div>

                {/* 事件槽 */}
                <div className="flex-1 relative min-w-0">
                  {/* 当前时间红线 */}
                  {isCurrentHour && (
                    <div
                      className="absolute left-0 right-0 pointer-events-none z-10"
                      style={{ top: `${(currentMinute / 60) * 100}%` }}
                    >
                      <div className="border-t-2 border-red-500 relative">
                        <span className="absolute -top-1.5 -left-1.5 w-3 h-3 rounded-full bg-red-500" />
                      </div>
                    </div>
                  )}

                  {/* 事件卡片 */}
                  {hourEvents.map((ev) => {
                    const colors = EVENT_COLORS[ev.source];
                    const isCompleted = ev.status === "completed";
                    const isOverdue = ev.status === "overdue";
                    const startMin = ev.time
                      ? parseInt(ev.time.split(":")[1], 10)
                      : 0;
                    const endMin = startMin + 60;

                    return (
                      <div
                        key={`${ev.source}-${ev.sourceId}`}
                        className={`absolute left-1 right-1 mx-0.5 px-2 py-1 rounded text-xs border-l-2 cursor-pointer
                          ${colors.bg} ${colors.text} ${colors.border}
                          ${isCompleted ? COMPLETED_STYLE : ""}
                          ${isOverdue ? OVERDUE_STYLE : ""}
                          hover:ring-1 hover:ring-blue-300 dark:hover:ring-blue-700 transition-shadow
                        `}
                        style={{
                          top: `${(startMin / 60) * 100}%`,
                          height: `${Math.max(((endMin - startMin) / 60) * 100, 8)}%`,
                          minHeight: "28px",
                        }}
                        title={`${ev.summary}${ev.time ? ` (${ev.time})` : ""}`}
                        onContextMenu={(e) => onContextMenu?.(e, ev)}
                      >
                        <div className="font-medium truncate text-[11px] leading-tight">
                          {ev.time && (
                            <span className="mr-1 opacity-70">{ev.time}</span>
                          )}
                          {ev.summary}
                        </div>
                        {ev.status && (
                          <span className="inline-block mt-0.5">
                            <StatusBadge status={ev.status} dotOnly />
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 底部统计栏 */}
      <div className="flex items-center gap-3 px-4 py-2 border-t border-gray-200 dark:border-gray-700 flex-shrink-0 text-xs text-gray-500 dark:text-gray-400">
        <span>待办 {stats.pending}</span>
        <span>·</span>
        <span>进行中 {stats.in_progress}</span>
        <span>·</span>
        <span>已完成 {stats.completed}</span>
        {stats.overdue > 0 && (
          <>
            <span>·</span>
            <span className="text-red-500 dark:text-red-400">
              超时 {stats.overdue}
            </span>
          </>
        )}
        <span className="ml-auto">
          共 {events.length} 项
        </span>
      </div>
    </div>
  );
}
