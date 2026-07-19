/**
 * SubModuleBar — 邮件/日历摘要栏
 * 可展开 inline 面板查看最近条目，点击「查看全部」跳转子页面
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useOfficeStore } from "../../../stores/officeStore";
import type { MailItem, CalendarEventItem } from "../../../types/office";

export function SubModuleBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { mailList, calendarEvents } = useOfficeStore();

  const [expandedPanel, setExpandedPanel] = useState<
    "none" | "mail" | "calendar"
  >("none");

  return (
    <div className="border-t border-gray-200 dark:border-gray-700">
      {/* 邮件入口 */}
      <button
        onClick={() =>
          setExpandedPanel(expandedPanel === "mail" ? "none" : "mail")
        }
        className="w-full flex items-center justify-between px-3 py-2 text-sm 
          hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        aria-expanded={expandedPanel === "mail"}
      >
        <span className="flex items-center gap-2">
          <span aria-hidden="true">📧</span>
          <span className="text-gray-700 dark:text-gray-300">
            {t("office.mail", "邮件")}
          </span>
          {mailList.length > 0 && (
            <span className="text-xs text-blue-600 dark:text-blue-400">
              ({mailList.length})
            </span>
          )}
        </span>
        <span
          className={`text-xs text-gray-400 transition-transform ${
            expandedPanel === "mail" ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        >
          ▼
        </span>
      </button>

      {/* 邮件 inline 展开面板 */}
      {expandedPanel === "mail" && (
        <InlineMailList
          mails={mailList.slice(0, 3)}
          onViewAll={() => {
            navigate("/office/mail");
            setExpandedPanel("none");
          }}
        />
      )}

      {/* 日历入口 */}
      <button
        onClick={() =>
          setExpandedPanel(expandedPanel === "calendar" ? "none" : "calendar")
        }
        className="w-full flex items-center justify-between px-3 py-2 text-sm 
          hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        aria-expanded={expandedPanel === "calendar"}
      >
        <span className="flex items-center gap-2">
          <span aria-hidden="true">📅</span>
          <span className="text-gray-700 dark:text-gray-300">
            {t("office.calendar", "日历")}
          </span>
          {calendarEvents.length > 0 && (
            <span className="text-xs text-blue-600 dark:text-blue-400">
              ({calendarEvents.length})
            </span>
          )}
        </span>
        <span
          className={`text-xs text-gray-400 transition-transform ${
            expandedPanel === "calendar" ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        >
          ▼
        </span>
      </button>

      {/* 日历 inline 展开面板 */}
      {expandedPanel === "calendar" && (
        <InlineCalendarList
          events={calendarEvents.slice(0, 3)}
          onViewAll={() => {
            navigate("/calendar");
            setExpandedPanel("none");
          }}
        />
      )}
    </div>
  );
}

/** 邮件 inline 列表 */
function InlineMailList({
  mails,
  onViewAll,
}: {
  mails: MailItem[];
  onViewAll: () => void;
}) {
  const { t } = useTranslation();

  if (mails.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">
        {t("office.noMail", "暂无邮件")}
      </div>
    );
  }

  return (
    <div className="px-2 pb-2">
      {mails.map((mail, i) => (
        <div
          key={mail.uid ?? i}
          className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 truncate 
            hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
          title={mail.subject}
        >
          <span className="font-medium text-gray-800 dark:text-gray-200">
            {mail.from}
          </span>
          {" — "}
          {mail.subject}
        </div>
      ))}
      <button
        onClick={onViewAll}
        className="w-full px-2 py-1 text-xs text-blue-600 dark:text-blue-400 
          hover:underline text-left"
      >
        {t("office.viewAll", "查看全部")} →
      </button>
    </div>
  );
}

/** 日历 inline 列表 */
function InlineCalendarList({
  events,
  onViewAll,
}: {
  events: CalendarEventItem[];
  onViewAll: () => void;
}) {
  const { t } = useTranslation();

  if (events.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">
        {t("office.noEvents", "暂无日程")}
      </div>
    );
  }

  return (
    <div className="px-2 pb-2">
      {events.map((ev) => (
        <div
          key={ev.id}
          className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 truncate 
            hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
          title={ev.summary}
        >
          <span className="text-gray-400">{ev.start?.slice(0, 10)}</span>
          {" "}
          <span className="font-medium text-gray-800 dark:text-gray-200">
            {ev.summary}
          </span>
        </div>
      ))}
      <button
        onClick={onViewAll}
        className="w-full px-2 py-1 text-xs text-blue-600 dark:text-blue-400 
          hover:underline text-left"
      >
        {t("office.viewAll", "查看全部")} →
      </button>
    </div>
  );
}
