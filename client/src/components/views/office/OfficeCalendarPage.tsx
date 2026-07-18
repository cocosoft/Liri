/**
 * OfficeCalendarPage — 日历管理子页面
 * 展示日历状态、日程管理、近期日程
 */

import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CalendarIcon } from "../../../assets/icons/navigation";

/** 日程项 */
interface EventItem {
  title: string;
  datetime: string;
  location: string;
  reminder: string;
  method: string;
}

export default function OfficeCalendarPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  /** 日历是否就绪 */
  const [ready, setReady] = useState<boolean | null>(null);
  /** 近期日程（第二轮接入真实 API） */
  const [events] = useState<EventItem[]>([]);
  /** 加载状态 */
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetchCalendarStatus(controller.signal).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  /** 获取日历模块状态 */
  async function fetchCalendarStatus(signal?: AbortSignal) {
    try {
      const res = await fetch("/v1/calendar/status", { signal });
      if (res.ok) {
        setReady(true);
      } else {
        setReady(false);
      }
    } catch {
      setReady(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-white dark:bg-gray-950">
      <div className="max-w-4xl mx-auto p-6">
        {/* 返回导航 */}
        <Link
          to="/office"
          className="inline-flex items-center text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 mb-4 transition-colors"
        >
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {t("office.backToHome", "返回办公")}
        </Link>

        {/* 日历状态 */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
            <CalendarIcon className="text-blue-600 dark:text-blue-400" size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {t("office.calendar", "日历")}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {loading
                ? "..."
                : ready === true
                  ? t("office.ready", "就绪")
                  : t("office.notReady", "未就绪")}
            </p>
          </div>
        </div>

        {/* 快捷操作 */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => navigate("/office/calendar")}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {t("office.addEvent", "添加日程")}
          </button>
          <button
            onClick={() => navigate("/office/calendar")}
            className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            {t("office.eventList", "日程列表")}
          </button>
          <button
            onClick={() => navigate("/office/calendar")}
            className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            {t("office.export", "导出 .ics")}
          </button>
        </div>

        {/* 近期日程 */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            {t("office.upcoming", "近期日程")}
          </h2>
          {events.length > 0 ? (
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl divide-y divide-gray-100 dark:divide-gray-800">
              {events.map((event, i) => (
                <div key={i} className="flex items-start gap-3 p-4">
                  <CalendarIcon className="text-blue-500 mt-0.5 shrink-0" size={18} />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                      {event.title}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {event.datetime} · {event.location}
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {event.reminder} · {event.method}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-8 text-center text-sm text-gray-400">
              {t("office.noEvents", "暂无日程，添加第一个日程开始使用")}
            </div>
          )}
        </div>

        {/* 快速操作 */}
        <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-900 rounded-xl">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            {t("office.quickActions", "快速操作")}
          </h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => navigate("/office/doc")}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {t("office.createDoc", "创建文档")}
            </button>
            <button
              onClick={() => navigate("/office/mail")}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {t("office.sendMail", "写邮件")}
            </button>
            <button
              onClick={() => navigate("/office/calendar")}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {t("office.addEvent", "添加日程")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
