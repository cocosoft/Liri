/**
 * OfficeCalendarPage — 日历管理子页面
 * 全宽两栏布局：左侧月历导航+筛选图例 + 右侧月/周/年日历面板（三源聚合）
 */

import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CalendarIcon } from "../../../assets/icons/navigation";
import { officeService } from "../../../services/officeService";
import { notificationService } from "../../../services/notificationService";
import { cronService } from "../../../services/cronService";
import { useOfficeStore } from "../../../stores/officeStore";
import { useConfigStore } from "../../../stores/configStore";
import type {
  CalendarEventItem,
  UnifiedCalendarEvent,
  EventSource,
  EventStatus,
} from "../../../types/office";
import type { CronTask } from "../../../types/schedule";
import { solarToLunar } from "../../../utils/lunarCalendar";
import { useSessionContextSync } from "../../../hooks/useSessionContextSync";
import CalendarAddDialog, {
  type CalendarAddFormData,
} from "./CalendarAddDialog";
import StatusBadge from "./StatusBadge";
import DayView from "./DayView";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const WEEKDAYS_FULL = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const MONTH_NAMES = [
  "1月",
  "2月",
  "3月",
  "4月",
  "5月",
  "6月",
  "7月",
  "8月",
  "9月",
  "10月",
  "11月",
  "12月",
];
type ViewMode = "month" | "week" | "year" | "day";

/** 响应式布局 Hook */
function useCalendarLayout() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return {
    /** 图例位置 */
    legendPosition:
      width >= 1024
        ? ("sidebar" as const)
        : width >= 768
          ? ("top-collapsible" as const)
          : ("bottom-floating" as const),
    /** 每格最多显示事件数 */
    maxEventsPerCell: width >= 1024 ? 3 : width >= 768 ? 2 : 0,
    /** 事件显示模式 */
    cellDisplay: width >= 768 ? ("summary" as const) : ("dot" as const),
    /** 是否窄屏 */
    isNarrow: width < 1024,
  };
}

/** 事件来源颜色映射 */
const EVENT_COLORS: Record<
  EventSource,
  { bg: string; text: string; dot: string }
> = {
  manual: {
    bg: "bg-blue-100 dark:bg-blue-900",
    text: "text-blue-700 dark:text-blue-300",
    dot: "bg-blue-500",
  },
  cron: {
    bg: "bg-green-100 dark:bg-green-900",
    text: "text-green-700 dark:text-green-300",
    dot: "bg-green-500",
  },
  ai: {
    bg: "bg-purple-100 dark:bg-purple-900",
    text: "text-purple-700 dark:text-purple-300",
    dot: "bg-purple-500",
  },
};

/** Cron 状态覆盖颜色 */
const CRON_STATE_COLORS: Record<string, string> = {
  failed:
    "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 line-through",
  paused: "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500",
};

export default function OfficeCalendarPage() {
  const { t } = useTranslation();
  const {
    mergedCalendar,
    mergedErrors,
    visibleSources,
    statusFilter,
    setMergedCalendar,
    setCalendarLoading,
    toggleVisibleSource,
    setStatusFilter,
    setCalendarEvents,
  } = useOfficeStore();

  const config = useConfigStore((s) => s.config);
  const configTimezone = (config.timezone as string) || undefined;

  const layout = useCalendarLayout();
  /** 窄屏侧栏折叠状态 */
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("month");

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  /** 周视图偏移量（0=当前周，-1=上周，1=下周） */
  const [weekOffset, setWeekOffset] = useState(0);

  /** 右键菜单状态 */
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    event: UnifiedCalendarEvent;
    source: EventSource;
  } | null>(null);

  /** 拖拽提示 */
  const [dragTip, setDragTip] = useState<string | null>(null);

  /** 定时任务面板 */
  const [cronTasks, setCronTasks] = useState<CronTask[]>([]);
  const [cronPanelOpen, setCronPanelOpen] = useState(true);
  const [cronLoading, setCronLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    refreshMerged();
    fetchCronTasks();
    return () => controller.abort();
  }, []);

  /** 获取定时任务列表 */
  async function fetchCronTasks() {
    setCronLoading(true);
    try {
      const tasks = await cronService.list();
      setCronTasks(tasks);
    } catch {
      /* 静默失败 */
    } finally {
      setCronLoading(false);
    }
  }

  /** 切换定时任务启用状态 */
  async function handleCronToggleEnabled(task: CronTask) {
    try {
      await cronService.toggle(task.id, !task.enabled);
      setCronTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, enabled: !task.enabled } : t,
        ),
      );
    } catch {
      /* ignored */
    }
  }

  /** 计算当前视图的日期范围 */
  function getViewRange(): { start: string; end: string } {
    let start: Date, end: Date;
    if (viewMode === "year") {
      start = new Date(viewYear, 0, 1);
      end = new Date(viewYear + 1, 0, 1);
    } else if (viewMode === "week") {
      const now = new Date();
      const currentMonday = new Date(now);
      const dow = now.getDay();
      currentMonday.setDate(now.getDate() - dow + (dow === 0 ? -6 : 1));
      start = new Date(currentMonday);
      start.setDate(currentMonday.getDate() + weekOffset * 7);
      end = new Date(start);
      end.setDate(start.getDate() + 7);
    } else {
      start = new Date(viewYear, viewMonth - 1, 1); // 上一个月第一天（缓冲区）
      end = new Date(viewYear, viewMonth + 2, 1); // 下一个月第一天
    }
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  }

  /** 刷新聚合日历数据 */
  async function refreshMerged() {
    setCalendarLoading(true);
    try {
      const statusRes = await officeService.getCalendarStatus();
      const ok =
        (statusRes as unknown as Record<string, unknown>)?.ok !== false;
      if (ok) {
        const { start, end } = getViewRange();
        const res = await officeService.getCalendarMerged(
          start,
          end,
          configTimezone,
        );
        const envelope = (res as unknown as Record<string, unknown>)
          ?.data as Record<string, unknown>;
        if (envelope?.data) {
          setMergedCalendar(
            envelope.data as Parameters<typeof setMergedCalendar>[0],
          );
          // 同步传统 calendarEvents（向后兼容）
          const evts =
            (envelope.data as { calendarEvents?: CalendarEventItem[] })
              .calendarEvents ?? [];
          setCalendarEvents(evts);
        }
      }
    } catch {
      setCalendarLoading(false);
    }
  }

  /** 视图变化时重新加载 */
  useEffect(() => {
    refreshMerged();
  }, [viewYear, viewMonth, weekOffset, viewMode]);

  /** 模块上下文同步：保存/恢复 CalendarSessionContext */
  useSessionContextSync("calendar", {
    save: () => ({
      moduleType: "calendar" as const,
      view: (viewMode === "year" ? "month" : viewMode) as
        "month" | "week" | "day",
      dateRange: getViewRange(),
    }),
    restore: (ctx) => {
      if (ctx.moduleType !== "calendar") return;
      if (ctx.view === "month" || ctx.view === "week") {
        setViewMode(ctx.view);
      }
    },
  });

  /** 构建统一事件列表 */
  const unifiedEvents = useMemo((): UnifiedCalendarEvent[] => {
    if (!mergedCalendar) return [];
    const events: UnifiedCalendarEvent[] = [];

    // 手动日程
    for (const ev of mergedCalendar.data.calendarEvents ?? []) {
      if (!visibleSources.manual) continue;
      if (statusFilter !== "all" && ev.status !== statusFilter) continue;
      const dateStr = ev.start.slice(0, 10);
      const timeStr = ev.start.slice(11, 16);
      events.push({
        date: dateStr,
        time: timeStr || undefined,
        summary: ev.summary,
        source: "manual",
        sourceId: ev.id,
        draggable: true,
        action: { type: "edit", label: "编辑日程", payload: { id: ev.id } },
        status: ev.status,
        priority: ev.priority,
        tags: ev.tags,
        completedAt: ev.completedAt,
      });
    }

    // Cron 定时任务
    for (const cron of mergedCalendar.data.cronEvents ?? []) {
      if (!visibleSources.cron) continue;
      for (const occ of cron.occurrences) {
        events.push({
          date: occ.date,
          time: occ.time,
          summary: cron.name,
          source: "cron",
          sourceId: cron.jobId,
          state: cron.state,
          details: cron.schedule,
          draggable: false,
          action: {
            type: "navigate-cron",
            label: "查看任务",
            payload: { id: cron.jobId },
          },
        });
      }
    }

    // AI 日程
    for (const ai of mergedCalendar.data.aiSchedules ?? []) {
      if (!visibleSources.ai) continue;
      events.push({
        date: ai.date,
        time: ai.time,
        summary: ai.summary,
        source: "ai",
        sourceId: ai.id,
        details: ai.conversationSnippet,
        draggable: false,
        action: {
          type: "navigate-chat",
          label: "查看对话",
          payload: { id: ai.sessionId ?? "" },
        },
      });
    }

    return events;
  }, [mergedCalendar, visibleSources, statusFilter]);

  async function handleSaveEvent(data: CalendarAddFormData) {
    setSaving(true);
    setError(null);
    try {
      await officeService.addCalendarEvent({
        summary: data.summary,
        start: data.start,
        end: data.end,
        description: data.description,
        location: data.location,
        status: data.status,
        priority: data.priority,
        tags: data.tags ? data.tags.split(",").map((s) => s.trim()) : undefined,
      });
      // 同步到消息中心待办
      if (data.syncToNotification) {
        notificationService
          .create({
            category: "todo",
            title: data.summary,
            content: data.description || `${data.start} 开始`,
            source: "calendar",
            link_to: {
              type: "page",
              id: `/office/calendar?date=${data.start.slice(0, 10)}`,
              label: "查看日历",
            },
            expires_at: Math.floor(new Date(data.start).getTime() / 1000),
          })
          .catch(() => {
            /* 通知创建失败不影响日程保存 */
          });
      }
      refreshMerged();
    } catch {
      setError(t("office.calAddError", "添加日程失败"));
    } finally {
      setSaving(false);
    }
  }

  /** 更新事件状态 */
  async function handleUpdateEventStatus(id: string, status: EventStatus) {
    try {
      const res = await officeService.updateCalendarEventStatus(id, status);
      const wrapped = res as unknown as {
        ok?: boolean;
        error?: { message?: string };
      };
      if (wrapped.ok === false) {
        throw new Error(wrapped.error?.message ?? "未知错误");
      }
      refreshMerged();
    } catch (err) {
      setError(
        `状态更新失败：${err instanceof Error ? err.message : String(err)}`,
      );
      setTimeout(() => setError(null), 4000);
    }
  }

  /** 删除日程后刷新 */
  async function handleDeleteEvent(id: string) {
    try {
      await officeService.deleteCalendarEvent(id);
      refreshMerged();
    } catch {
      /* ignored */
    }
  }

  /** 右键菜单 — 处理 Cron 事件右键 */
  function handleContextMenu(e: React.MouseEvent, ev: UnifiedCalendarEvent) {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      event: ev,
      source: ev.source,
    });
  }

  /** 关闭右键菜单 */
  function closeContextMenu() {
    setContextMenu(null);
  }

  /** 右键菜单 — 立即执行 Cron 任务 */
  async function handleCronRunNow(jobId: string) {
    try {
      await cronService.runNow(jobId);
      closeContextMenu();
      refreshMerged();
    } catch {
      /* ignored */
    }
  }

  /** 右键菜单 — 暂停/恢复 Cron 任务 */
  async function handleCronToggle(jobId: string, enabled: boolean) {
    try {
      await cronService.toggle(jobId, !enabled);
      closeContextMenu();
      refreshMerged();
    } catch {
      /* ignored */
    }
  }

  /** 右键菜单 — 删除 Cron 任务 */
  async function handleCronDelete(jobId: string) {
    try {
      await cronService.delete(jobId);
      closeContextMenu();
      refreshMerged();
    } catch {
      /* ignored */
    }
  }

  /** 拖拽开始 — 非手动日程阻止拖拽并显示提示 */
  function handleDragStart(e: React.DragEvent, ev: UnifiedCalendarEvent) {
    if (!ev.draggable) {
      e.preventDefault();
      setDragTip(t("office.calCronCantDrag", "请到定时任务页面修改调度时间"));
      setTimeout(() => setDragTip(null), 2500);
      return;
    }
    e.dataTransfer.setData(
      "text/plain",
      JSON.stringify({ id: ev.sourceId, date: ev.date }),
    );
  }

  // 全局点击关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => closeContextMenu();
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [contextMenu]);

  /** 左侧迷你日历网格 */
  const miniGrid = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: Array<{ day: number | null; dateStr: string | null }> = [];
    for (let i = 0; i < firstDay; i++) cells.push({ day: null, dateStr: null });
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        day: d,
        dateStr: `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      });
    }
    return cells;
  }, [viewYear, viewMonth]);

  /** 右侧大月历：按周分组，每格含当天统一事件 */
  const monthWeeks = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const lastDayPrev = new Date(viewYear, viewMonth, 0).getDate();

    // 使用 unifiedEvents 构建按日分组
    const eventsByDay = new Map<string, UnifiedCalendarEvent[]>();
    for (const ev of unifiedEvents) {
      if (!eventsByDay.has(ev.date)) eventsByDay.set(ev.date, []);
      eventsByDay.get(ev.date)!.push(ev);
    }

    const weeks: Array<
      Array<{
        day: number;
        dateStr: string;
        isCurrentMonth: boolean;
        isToday: boolean;
        events: UnifiedCalendarEvent[];
        lunar: string;
      }>
    > = [];
    let day = 1,
      nextMonthDay = 1;

    /** 获取日期的农历日名（仅当月日期） */
    const getLunar = (y: number, m: number, d: number): string => {
      try {
        const l = solarToLunar(y, m, d);
        // 初一显示月名，否则只显示日名
        return l.day === 1 ? l.monthName : l.dayName;
      } catch {
        return "";
      }
    };

    for (let w = 0; w < 6; w++) {
      const week: (typeof weeks)[0] = [];
      for (let d = 0; d < 7; d++) {
        const idx = w * 7 + d;
        if (idx < firstDay) {
          const prevDay = lastDayPrev - firstDay + idx + 1;
          const prevM = viewMonth === 0 ? 12 : viewMonth;
          const prevY = viewMonth === 0 ? viewYear - 1 : viewYear;
          const dateStr = `${prevY}-${String(prevM).padStart(2, "0")}-${String(prevDay).padStart(2, "0")}`;
          week.push({
            day: prevDay,
            dateStr,
            isCurrentMonth: false,
            isToday: false,
            events: eventsByDay.get(dateStr) ?? [],
            lunar: "",
          });
        } else if (day <= daysInMonth) {
          const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const lunar = getLunar(viewYear, viewMonth + 1, day);
          week.push({
            day,
            dateStr,
            isCurrentMonth: true,
            isToday: dateStr === todayStr,
            events: eventsByDay.get(dateStr) ?? [],
            lunar,
          });
          day++;
        } else {
          const nextM = viewMonth === 11 ? 1 : viewMonth + 2;
          const nextY = viewMonth === 11 ? viewYear + 1 : viewYear;
          const dateStr = `${nextY}-${String(nextM).padStart(2, "0")}-${String(nextMonthDay).padStart(2, "0")}`;
          week.push({
            day: nextMonthDay,
            dateStr,
            isCurrentMonth: false,
            isToday: false,
            events: eventsByDay.get(dateStr) ?? [],
            lunar: "",
          });
          nextMonthDay++;
        }
      }
      weeks.push(week);
      if (day > daysInMonth) break;
    }
    return weeks;
  }, [viewYear, viewMonth, unifiedEvents, todayStr]);

  /** 周视图：基于 weekOffset 的 7 天 */
  const weekDays = useMemo(() => {
    const now = new Date();
    const currentMonday = new Date(now);
    const dow = now.getDay();
    currentMonday.setDate(now.getDate() - dow + (dow === 0 ? -6 : 1));

    const monday = new Date(currentMonday);
    monday.setDate(currentMonday.getDate() + weekOffset * 7);

    const eventsByDay = new Map<string, UnifiedCalendarEvent[]>();
    for (const ev of unifiedEvents) {
      if (!eventsByDay.has(ev.date)) eventsByDay.set(ev.date, []);
      eventsByDay.get(ev.date)!.push(ev);
    }

    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const lunar = (() => {
        try {
          const l = solarToLunar(
            d.getFullYear(),
            d.getMonth() + 1,
            d.getDate(),
          );
          return l.day === 1 ? l.monthName : l.dayName;
        } catch {
          return "";
        }
      })();
      return {
        day: d.getDate(),
        month: d.getMonth() + 1,
        dateStr,
        weekday: WEEKDAYS_FULL[i],
        isToday: dateStr === todayStr,
        lunar,
        events: eventsByDay.get(dateStr) ?? [],
      };
    });
  }, [viewYear, viewMonth, unifiedEvents, todayStr, weekOffset]);

  /** 年视图：12 个月的迷你日历 */
  const yearGrid = useMemo(() => {
    return Array.from({ length: 12 }, (_, m) => {
      const firstDay = new Date(viewYear, m, 1).getDay();
      const daysInMonth = new Date(viewYear, m + 1, 0).getDate();
      const cells: Array<{
        day: number | null;
        dateStr: string | null;
        isToday: boolean;
      }> = [];
      for (let i = 0; i < firstDay; i++)
        cells.push({ day: null, dateStr: null, isToday: false });
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${viewYear}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        cells.push({ day: d, dateStr, isToday: dateStr === todayStr });
      }
      return { month: m, cells };
    });
  }, [viewYear, todayStr]);

  const selectedEvents = useMemo(() => {
    if (!selectedDate) return [];
    return unifiedEvents.filter((ev) => ev.date === selectedDate);
  }, [unifiedEvents, selectedDate]);

  const prevMonth = () => {
    if (viewMode === "year") {
      setViewYear(viewYear - 1);
      return;
    }
    if (viewMode === "week") {
      setWeekOffset(weekOffset - 1);
      return;
    }
    if (viewMonth === 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else setViewMonth(viewMonth - 1);
    setSelectedDate(null);
  };
  const nextMonth = () => {
    if (viewMode === "year") {
      setViewYear(viewYear + 1);
      return;
    }
    if (viewMode === "week") {
      setWeekOffset(weekOffset + 1);
      return;
    }
    if (viewMonth === 11) {
      setViewYear(viewYear + 1);
      setViewMonth(0);
    } else setViewMonth(viewMonth + 1);
    setSelectedDate(null);
  };
  const goToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    setWeekOffset(0);
    setSelectedDate(todayStr);
  };
  const handleDayClick = (dateStr: string) => {
    setSelectedDate(dateStr === selectedDate ? null : dateStr);
  };

  /** 双击某天 → 打开日视图 */
  const handleDayDoubleClick = (dateStr: string) => {
    setSelectedDate(dateStr);
    setViewMode("day");
  };

  return (
    <>
      <div className="h-full w-full min-h-0 flex bg-white dark:bg-gray-950">
        {/* 左侧：迷你月历 + 操作 — 响应式 */}
        <div
          className={`${layout.isNarrow ? (sidebarOpen ? "fixed inset-y-0 left-0 z-40 w-[280px]" : "hidden") : "w-[280px] flex-shrink-0"} border-r border-gray-200 dark:border-gray-700 flex flex-col bg-gray-50 dark:bg-gray-950`}
        >
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 dark:border-gray-700">
            <Link
              to="/office"
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center gap-1"
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
              {t("office.backToHome", "返回")}
            </Link>
          </div>
          <div className="flex items-center gap-2 px-3 py-3">
            <CalendarIcon
              className="text-blue-600 dark:text-blue-400"
              size={20}
            />
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("office.calendar", "日历")}
            </span>
          </div>

          <div className="flex items-center justify-between px-3 pb-2">
            <button
              onClick={prevMonth}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-sm"
            >
              ◀
            </button>
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {viewYear}年{viewMonth + 1}月
            </span>
            <button
              onClick={nextMonth}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-sm"
            >
              ▶
            </button>
          </div>
          <div className="grid grid-cols-7 px-2 pb-1">
            {WEEKDAYS.map((d) => (
              <div key={d} className="text-center text-xs text-gray-400 py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 px-2 gap-0.5 mb-2">
            {miniGrid.map((cell, i) => {
              const hasEvents =
                cell.dateStr &&
                unifiedEvents.some((ev) => ev.date === cell.dateStr);
              const isToday = cell.dateStr === todayStr;
              const isSelected = cell.dateStr === selectedDate;
              return (
                <div
                  key={i}
                  onClick={() => cell.dateStr && handleDayClick(cell.dateStr)}
                  onDoubleClick={() =>
                    cell.dateStr && handleDayDoubleClick(cell.dateStr)
                  }
                  className={`aspect-square flex items-center justify-center text-xs rounded-full relative
                  ${cell.day === null ? "" : "cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900"}
                  ${isToday ? "bg-blue-600 text-white font-bold" : ""}
                  ${isSelected && !isToday ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium" : ""}
                  ${!isToday && !isSelected && cell.day !== null ? "text-gray-700 dark:text-gray-300" : ""}`}
                >
                  {cell.day}
                  {hasEvents && !isToday && (
                    <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-blue-500" />
                  )}
                </div>
              );
            })}
          </div>

          <div className="px-3 pb-2">
            <button
              onClick={goToday}
              className="w-full px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              📍 {t("office.calToday", "今天")}
            </button>
          </div>
          <div className="px-2 py-2 space-y-1 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={() => {
                setShowAddDialog(true);
                if (!selectedDate) setSelectedDate(todayStr);
              }}
              className="w-full px-2 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              + {t("office.calAdd", "添加日程")}
            </button>
            <button
              onClick={() => refreshMerged()}
              className="w-full px-2 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              🔄 {t("office.calRefresh", "刷新")}
            </button>
          </div>
          <div className="px-2 pb-2">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("office.calSearchPlaceholder", "搜索日程...")}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </div>

          {/* 筛选图例 */}
          <div className="px-2 pb-2 border-t border-gray-200 dark:border-gray-700 pt-2">
            <div className="text-[10px] text-gray-400 mb-1 px-1">
              图例（点击切换）
            </div>
            {(["manual", "cron", "ai"] as EventSource[]).map((src) => {
              const label =
                src === "manual"
                  ? "手动日程"
                  : src === "cron"
                    ? "定时任务"
                    : "AI 提取";
              const icon =
                src === "manual" ? "🔵" : src === "cron" ? "🟢" : "🟣";
              const hasError = mergedErrors.some((e) => e.source === src);
              return (
                <div
                  key={src}
                  onClick={() => toggleVisibleSource(src)}
                  className={`flex items-center gap-1.5 px-1 py-1 text-xs rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors
                  ${visibleSources[src] ? "" : "opacity-40"}`}
                  title={
                    hasError
                      ? mergedErrors.find((e) => e.source === src)?.message
                      : undefined
                  }
                >
                  <span>{icon}</span>
                  <span className="text-gray-700 dark:text-gray-300 flex-1">
                    {label}
                  </span>
                  <span className="text-gray-400">
                    {visibleSources[src] ? "✓" : "✗"}
                  </span>
                  {hasError && (
                    <span className="text-yellow-500 text-xs">⚠️</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* 状态筛选 */}
          <div className="px-2 pb-2 border-t border-gray-200 dark:border-gray-700 pt-2">
            <div className="text-[10px] text-gray-400 mb-1 px-1">状态筛选</div>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  "all",
                  "pending",
                  "in_progress",
                  "completed",
                  "cancelled",
                  "overdue",
                ] as Array<EventStatus | "all">
              ).map((s) => {
                const labelMap: Record<string, string> = {
                  all: "全部",
                  pending: "待办",
                  in_progress: "进行中",
                  completed: "已完成",
                  cancelled: "已取消",
                  overdue: "超时",
                };
                return (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full transition-colors
                      ${
                        statusFilter === s
                          ? "bg-blue-600 text-white"
                          : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                      }`}
                  >
                    {labelMap[s]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 定时任务面板 */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
            <div
              onClick={() => setCronPanelOpen(!cronPanelOpen)}
              className="flex items-center justify-between px-2 py-1 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-xs">⏰</span>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  {t("nav.cron", "定时任务")}
                </span>
                {cronTasks.length > 0 && (
                  <span className="text-[10px] bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded-full">
                    {cronTasks.length}
                  </span>
                )}
              </div>
              <span
                className="text-[10px] text-gray-400 transition-transform"
                style={{
                  transform: cronPanelOpen ? "rotate(90deg)" : "rotate(0deg)",
                }}
              >
                ▶
              </span>
            </div>

            {cronPanelOpen && (
              <div className="mt-1 max-h-[240px] overflow-y-auto">
                {cronLoading && (
                  <div className="px-2 py-3 text-xs text-gray-400 text-center">
                    加载中...
                  </div>
                )}
                {!cronLoading && cronTasks.length === 0 && (
                  <div className="px-2 py-3 text-xs text-gray-400 text-center">
                    暂无定时任务
                  </div>
                )}
                {cronTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors group"
                  >
                    {/* 开关 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCronToggleEnabled(task);
                      }}
                      className={`flex-shrink-0 w-7 h-4 rounded-full transition-colors relative
                      ${task.enabled ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"}`}
                    >
                      <span
                        className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform
                      ${task.enabled ? "left-3.5" : "left-0.5"}`}
                      />
                    </button>
                    {/* 名称 + 状态 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-700 dark:text-gray-300 truncate">
                          {task.name}
                        </span>
                        {task.status === "error" && (
                          <span className="text-[10px] px-1 py-0.5 rounded bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400 flex-shrink-0">
                            异常
                          </span>
                        )}
                        {task.status === "running" && (
                          <span className="text-[10px] px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 flex-shrink-0">
                            运行中
                          </span>
                        )}
                      </div>
                      {task.scheduleDisplay && (
                        <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                          {task.scheduleDisplay}
                        </div>
                      )}
                    </div>
                    {/* 详情链接 */}
                    <Link
                      to={`/cron?jobId=${task.id}`}
                      className="flex-shrink-0 text-[10px] text-gray-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      详情
                    </Link>
                  </div>
                ))}
                {/* 查看全部 */}
                <Link
                  to="/cron"
                  className="block px-2 py-1.5 text-xs text-center text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950 rounded transition-colors mt-1"
                >
                  查看全部定时任务 →
                </Link>
              </div>
            )}
          </div>

          {selectedDate && selectedEvents.length > 0 && (
            <div className="flex-1 overflow-y-auto border-t border-gray-200 dark:border-gray-700">
              <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                {selectedDate} ({selectedEvents.length})
              </div>
              <div className="space-y-0.5 px-2 pb-2">
                {selectedEvents.map((ev) => {
                  const colors = EVENT_COLORS[ev.source];
                  const stateColors = ev.state && CRON_STATE_COLORS[ev.state];
                  return (
                    <div
                      key={`${ev.source}-${ev.sourceId}`}
                      className={`px-2 py-1.5 rounded-lg text-xs ${stateColors ?? `${colors.bg} ${colors.text}`}`}
                    >
                      <div className="font-medium truncate">
                        {ev.summary}
                        {ev.status && (
                          <span className="ml-1">
                            <StatusBadge status={ev.status} />
                          </span>
                        )}
                      </div>
                      <div className="text-gray-400">
                        {ev.time ? `${ev.time}` : ""}{" "}
                        {ev.details ? `· ${ev.details}` : ""}
                      </div>
                      {ev.source === "manual" && (
                        <button
                          onClick={() => handleDeleteEvent(ev.sourceId)}
                          className="text-red-400 hover:text-red-600 mt-0.5"
                        >
                          删除
                        </button>
                      )}
                      {ev.source === "cron" && (
                        <Link
                          to={`/cron?jobId=${ev.sourceId}`}
                          className="text-green-400 hover:text-green-600 mt-0.5 block"
                        >
                          查看任务 →
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 右侧：完整月历面板 */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {error && (
            <div className="mx-4 mt-3 p-2 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-2 underline">
                {t("office.close", "关闭")}
              </button>
            </div>
          )}

          {showAddDialog && (
            <CalendarAddDialog
              open={showAddDialog}
              onClose={() => setShowAddDialog(false)}
              defaultDate={selectedDate ?? undefined}
              onSave={handleSaveEvent}
            />
          )}

          {/* 月/周/年 切换面板 */}
          <div className="flex-1 flex flex-col min-h-0">
            {/* 视图切换 bar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-1">
                {/* 窄屏侧栏切换按钮 */}
                {layout.isNarrow && (
                  <button
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className="px-2 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 rounded mr-1"
                    title={sidebarOpen ? "关闭侧栏" : "打开侧栏"}
                  >
                    ☰
                  </button>
                )}
                {(["month", "week", "year"] as ViewMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setViewMode(m);
                      setWeekOffset(0);
                    }}
                    className={`px-3 py-1 text-xs rounded-full transition-colors
                    ${viewMode === m ? "bg-blue-600 text-white" : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
                  >
                    {m === "month" ? "月" : m === "week" ? "周" : "年"}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                {viewMode === "year" ? (
                  <>
                    <button
                      onClick={prevMonth}
                      className="px-2 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-600 dark:text-gray-400"
                    >
                      ◀ 上一年
                    </button>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                      {viewYear}年
                    </h2>
                    <button
                      onClick={nextMonth}
                      className="px-2 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-600 dark:text-gray-400"
                    >
                      下一年 ▶
                    </button>
                  </>
                ) : viewMode === "week" ? (
                  <>
                    <button
                      onClick={prevMonth}
                      className="px-2 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-600 dark:text-gray-400"
                    >
                      ◀ 上周
                    </button>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                      {viewYear}年 {MONTH_NAMES[viewMonth]}
                    </h2>
                    <button
                      onClick={nextMonth}
                      className="px-2 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-600 dark:text-gray-400"
                    >
                      下周 ▶
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={prevMonth}
                      className="px-2 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-600 dark:text-gray-400"
                    >
                      ◀ 上月
                    </button>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                      {viewYear}年 {MONTH_NAMES[viewMonth]}
                    </h2>
                    <button
                      onClick={nextMonth}
                      className="px-2 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-600 dark:text-gray-400"
                    >
                      下月 ▶
                    </button>
                  </>
                )}
              </div>
              <div className="w-[104px]" /> {/* spacer for balance */}
            </div>

            {/* ========== 日视图 ========== */}
            {viewMode === "day" && selectedDate && (
              <DayView
                dateStr={selectedDate}
                events={unifiedEvents.filter((ev) => ev.date === selectedDate)}
                onBack={() => setViewMode("month")}
                onAddEvent={() => {
                  setShowAddDialog(true);
                }}
                onUpdateStatus={handleUpdateEventStatus}
                onDeleteEvent={handleDeleteEvent}
                onContextMenu={handleContextMenu}
              />
            )}

            {/* ========== 月视图 ========== */}
            {viewMode === "month" && (
              <>
                <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700">
                  {WEEKDAYS.map((d, i) => (
                    <div
                      key={d}
                      className={`text-center text-xs font-medium py-2 ${i === 0 || i === 6 ? "text-red-400 dark:text-red-500" : "text-gray-500 dark:text-gray-400"}`}
                    >
                      {d}
                    </div>
                  ))}
                </div>
                <div className="flex-1 flex flex-col min-h-0">
                  {monthWeeks.map((week, wi) => (
                    <div
                      key={wi}
                      className="flex-1 grid grid-cols-7 border-b border-gray-100 dark:border-gray-800 min-h-0"
                    >
                      {week.map((cell, di) => (
                        <div
                          key={di}
                          onClick={() =>
                            cell.isCurrentMonth && handleDayClick(cell.dateStr)
                          }
                          onDoubleClick={() =>
                            cell.isCurrentMonth &&
                            handleDayDoubleClick(cell.dateStr)
                          }
                          className={`border-r border-gray-100 dark:border-gray-800 p-1 min-h-0 overflow-hidden
                          ${cell.isCurrentMonth ? "cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950" : "bg-gray-50 dark:bg-gray-900/50 opacity-50"}
                          ${cell.dateStr === selectedDate ? "ring-2 ring-blue-400 ring-inset bg-blue-50/50 dark:bg-blue-950/50" : ""}`}
                        >
                          <div
                            className={`text-xs mb-0.5 font-medium ${di === 0 || di === 6 ? "text-red-400 dark:text-red-500" : "text-gray-500 dark:text-gray-400"}`}
                          >
                            {cell.isToday ? (
                              <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs">
                                {cell.day}
                              </span>
                            ) : (
                              cell.day
                            )}
                          </div>
                          {cell.isCurrentMonth && cell.lunar && (
                            <div className="text-[10px] leading-tight text-gray-400 dark:text-gray-500 mb-0.5">
                              {cell.lunar}
                            </div>
                          )}
                          <div className="space-y-0.5 overflow-hidden">
                            {cell.events
                              .slice(0, layout.maxEventsPerCell || 99)
                              .map((ev) => {
                                const colors = EVENT_COLORS[ev.source];
                                const stateColors =
                                  ev.state && CRON_STATE_COLORS[ev.state];
                                // 窄屏仅显示圆点
                                if (layout.cellDisplay === "dot") {
                                  return (
                                    <span
                                      key={`${ev.source}-${ev.sourceId}`}
                                      className={`inline-block w-1.5 h-1.5 rounded-full ${colors.dot} mx-0.5`}
                                      title={`${ev.summary} (${ev.time ?? ""})`}
                                    />
                                  );
                                }
                                return (
                                  <div
                                    key={`${ev.source}-${ev.sourceId}`}
                                    className={`text-xs px-1 py-0.5 rounded truncate leading-tight ${stateColors ?? `${colors.bg} ${colors.text}`}`}
                                    title={`${ev.summary} (${ev.time ?? ""})`}
                                    draggable={ev.draggable}
                                    onDragStart={(e) => handleDragStart(e, ev)}
                                    onContextMenu={(e) =>
                                      handleContextMenu(e, ev)
                                    }
                                  >
                                    {ev.time ? (
                                      <span className="mr-0.5 opacity-70">
                                        {ev.time}
                                      </span>
                                    ) : null}
                                    {ev.summary}
                                    {ev.status && (
                                      <span className="ml-0.5 inline-block align-middle">
                                        <StatusBadge
                                          status={ev.status}
                                          dotOnly
                                        />
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            {layout.maxEventsPerCell > 0 &&
                              cell.events.length > layout.maxEventsPerCell && (
                                <div className="text-xs text-gray-400 px-1">
                                  +
                                  {cell.events.length - layout.maxEventsPerCell}
                                </div>
                              )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ========== 周视图 ========== */}
            {viewMode === "week" && (
              <div className="flex-1 flex flex-col min-h-0 overflow-auto">
                <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                  {weekDays.map((wd) => (
                    <div
                      key={wd.dateStr}
                      className={`text-center py-2 border-r border-gray-100 dark:border-gray-800 last:border-r-0
                      ${wd.isToday ? "bg-blue-50 dark:bg-blue-950" : ""}`}
                    >
                      <div
                        className={`text-xs ${wd.isToday ? "text-blue-600 dark:text-blue-400 font-semibold" : "text-gray-500 dark:text-gray-400"}`}
                      >
                        {wd.weekday}
                      </div>
                      <div
                        className={`text-lg font-semibold mt-0.5 ${wd.isToday ? "text-blue-600 dark:text-blue-400" : "text-gray-900 dark:text-white"}`}
                      >
                        {wd.isToday ? (
                          <span className="w-8 h-8 rounded-full bg-blue-600 text-white inline-flex items-center justify-center">
                            {wd.day}
                          </span>
                        ) : (
                          wd.day
                        )}
                      </div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                        {wd.lunar}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex-1 grid grid-cols-7 min-h-0">
                  {weekDays.map((wd) => (
                    <div
                      key={wd.dateStr}
                      onClick={() => handleDayClick(wd.dateStr)}
                      onDoubleClick={() => handleDayDoubleClick(wd.dateStr)}
                      className={`border-r border-gray-100 dark:border-gray-800 last:border-r-0 p-2 overflow-y-auto
                      cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900
                      ${wd.isToday ? "bg-blue-50/50 dark:bg-blue-950/50" : ""}
                      ${wd.dateStr === selectedDate ? "ring-2 ring-blue-400 ring-inset" : ""}`}
                    >
                      {wd.events.length === 0 ? (
                        <div className="text-xs text-gray-300 dark:text-gray-600 mt-2 text-center">
                          无日程
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {wd.events.map((ev) => {
                            const colors = EVENT_COLORS[ev.source];
                            const stateColors =
                              ev.state && CRON_STATE_COLORS[ev.state];
                            return (
                              <div
                                key={`${ev.source}-${ev.sourceId}`}
                                className={`text-xs px-1.5 py-1 rounded ${stateColors ?? `${colors.bg} ${colors.text}`}`}
                                title={`${ev.summary}${ev.details ? ` · ${ev.details}` : ""}`}
                                draggable={ev.draggable}
                                onDragStart={(e) => handleDragStart(e, ev)}
                                onContextMenu={(e) => handleContextMenu(e, ev)}
                              >
                                <div className="font-medium truncate">
                                  {ev.summary}
                                  {ev.status && (
                                    <span className="ml-0.5 inline-block align-middle">
                                      <StatusBadge status={ev.status} dotOnly />
                                    </span>
                                  )}
                                </div>
                                <div className="mt-0.5 opacity-70">
                                  {ev.time ? `${ev.time}` : ""}
                                  {ev.details && ev.source !== "manual"
                                    ? ` · ${ev.details}`
                                    : ""}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ========== 年视图 ========== */}
            {viewMode === "year" && (
              <div className="flex-1 overflow-y-auto p-3">
                <div className="grid grid-cols-4 gap-3">
                  {yearGrid.map((m) => (
                    <div
                      key={m.month}
                      onClick={() => {
                        setViewMonth(m.month);
                        setViewMode("month");
                      }}
                      className="border border-gray-200 dark:border-gray-700 rounded-lg p-2 cursor-pointer hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors"
                    >
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 text-center">
                        {MONTH_NAMES[m.month]}
                        {m.month === today.getMonth() &&
                          viewYear === today.getFullYear() && (
                            <span className="ml-1 text-blue-500">●</span>
                          )}
                      </div>
                      <div className="grid grid-cols-7 gap-px">
                        {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
                          <div
                            key={d}
                            className="text-[9px] text-center text-gray-400 py-0.5"
                          >
                            {d}
                          </div>
                        ))}
                        {m.cells.map((cell, ci) => (
                          <div
                            key={ci}
                            className={`text-[10px] text-center py-0.5 rounded-sm
                            ${cell.day === null ? "" : ""}
                            ${cell.isToday ? "bg-blue-600 text-white font-bold rounded-full" : "text-gray-600 dark:text-gray-400"}
                          `}
                          >
                            {cell.day}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 拖拽提示 Toast */}
      {dragTip && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-gray-800 text-white text-sm rounded-lg shadow-lg animate-pulse">
          {dragTip}
        </div>
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 手动日程 */}
          {contextMenu.source === "manual" && (
            <>
              <div className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                🔵 {contextMenu.event.summary}
                {contextMenu.event.status && (
                  <span className="ml-1">
                    <StatusBadge status={contextMenu.event.status} dotOnly />
                  </span>
                )}
              </div>
              {contextMenu.event.status !== "completed" && (
                <button
                  onClick={() => {
                    handleUpdateEventStatus(
                      contextMenu.event.sourceId,
                      "completed",
                    );
                    closeContextMenu();
                  }}
                  className="w-full text-left px-3 py-1.5 text-sm text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950 transition-colors"
                >
                  ✅ 标记为已完成
                </button>
              )}
              {contextMenu.event.status !== "in_progress" && (
                <button
                  onClick={() => {
                    handleUpdateEventStatus(
                      contextMenu.event.sourceId,
                      "in_progress",
                    );
                    closeContextMenu();
                  }}
                  className="w-full text-left px-3 py-1.5 text-sm text-yellow-600 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-950 transition-colors"
                >
                  🔄 标记为进行中
                </button>
              )}
              {contextMenu.event.status !== "pending" && (
                <button
                  onClick={() => {
                    handleUpdateEventStatus(
                      contextMenu.event.sourceId,
                      "pending",
                    );
                    closeContextMenu();
                  }}
                  className="w-full text-left px-3 py-1.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors"
                >
                  ⏸ 标记为待办
                </button>
              )}
              {contextMenu.event.status !== "cancelled" && (
                <button
                  onClick={() => {
                    handleUpdateEventStatus(
                      contextMenu.event.sourceId,
                      "cancelled",
                    );
                    closeContextMenu();
                  }}
                  className="w-full text-left px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  ❌ 标记为已取消
                </button>
              )}
              <div className="border-t border-gray-100 dark:border-gray-700 my-0.5" />
              <button
                onClick={() => {
                  handleDeleteEvent(contextMenu.event.sourceId);
                  closeContextMenu();
                }}
                className="w-full text-left px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
              >
                🗑 {t("office.calDelete", "删除")}
              </button>
            </>
          )}
          {/* Cron 定时任务 */}
          {contextMenu.source === "cron" && (
            <>
              <div className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                🟢 {contextMenu.event.summary}
              </div>
              <Link
                to={`/cron?jobId=${contextMenu.event.sourceId}`}
                onClick={closeContextMenu}
                className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors block"
              >
                📄 {t("office.calCronViewTask", "查看详情")}
              </Link>
              <button
                onClick={() => handleCronRunNow(contextMenu.event.sourceId)}
                className="w-full text-left px-3 py-1.5 text-sm text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950 flex items-center gap-2 transition-colors"
              >
                ▶️ {t("office.calCronRunNow", "立即执行一次")}
              </button>
              <button
                onClick={() =>
                  handleCronToggle(
                    contextMenu.event.sourceId,
                    contextMenu.event.state !== "paused",
                  )
                }
                className="w-full text-left px-3 py-1.5 text-sm text-yellow-600 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-950 flex items-center gap-2 transition-colors"
              >
                ⏸{" "}
                {contextMenu.event.state === "paused"
                  ? t("office.calCronResume", "恢复")
                  : t("office.calCronPause", "暂停")}
              </button>
              <button
                onClick={() => handleCronDelete(contextMenu.event.sourceId)}
                className="w-full text-left px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950 flex items-center gap-2 transition-colors"
              >
                ❌ {t("office.calCronDelete", "删除")}
              </button>
            </>
          )}
          {/* AI 提取日程 */}
          {contextMenu.source === "ai" && (
            <>
              <div className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                🟣 {contextMenu.event.summary}
              </div>
              <div className="px-3 py-1.5 text-xs text-gray-400 max-w-[200px] truncate">
                {contextMenu.event.details ||
                  t("office.calNoDetails", "无详细信息")}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
