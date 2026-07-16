/**
 * OfficePage — 办公模块入口页面
 * 展示 doc/mail/calendar 三个子模块的状态和入口
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** 文档图标 — SVG inline */
const FileTextIcon = ({ className = '', size = 24 }: { className?: string; size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

/** 邮件图标 — SVG inline */
const MailIcon = ({ className = '', size = 24 }: { className?: string; size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);

/** 日历图标 — SVG inline */
const CalendarIcon = ({ className = '', size = 24 }: { className?: string; size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

/** 模块状态卡片 */
interface ModuleStatus {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  description: string;
  status: "active" | "warning" | "inactive";
  statusText: string;
  path: string;
}

export default function OfficePage() {
  const { t } = useTranslation();
  const [modules, setModules] = useState<ModuleStatus[]>([]);

  useEffect(() => {
    // 异步获取各模块状态
    fetchOfficeStatus();
  }, []);

  async function fetchOfficeStatus() {
    try {
      const [docRes, mailRes, calRes] = await Promise.all([
        fetch("/v1/doc/status").catch(() => null),
        fetch("/v1/mail/status").catch(() => null),
        fetch("/v1/calendar/status").catch(() => null),
      ]);

      setModules([
        {
          id: "doc",
          name: t("office.doc", "文档"),
          icon: FileTextIcon,
          description: t("office.docDesc", "基于 OfficeCLI 的 Word/Excel/PPT 文档创建与编辑"),
          status: docRes?.ok ? "active" : "warning",
          statusText: docRes?.ok ? t("office.connected", "已连接") : t("office.notInstalled", "未安装 OfficeCLI"),
          path: "/office/doc",
        },
        {
          id: "mail",
          name: t("office.mail", "邮件"),
          icon: MailIcon,
          description: t("office.mailDesc", "SMTP/IMAP 邮件收发，支持 OAuth2 认证"),
          status: mailRes?.ok ? "active" : "warning",
          statusText: mailRes?.ok ? t("office.configured", "已配置") : t("office.notConfigured", "未配置"),
          path: "/office/mail",
        },
        {
          id: "calendar",
          name: t("office.calendar", "日历"),
          icon: CalendarIcon,
          description: t("office.calendarDesc", "日程管理与事件提醒"),
          status: calRes?.ok ? "active" : "warning",
          statusText: calRes?.ok ? t("office.ready", "就绪") : t("office.notReady", "未就绪"),
          path: "/office/calendar",
        },
      ]);
    } catch {
      // 后端不可用时显示占位
      setModules([
        {
          id: "doc", name: t("office.doc", "文档"), icon: FileTextIcon,
          description: "", status: "inactive", statusText: t("office.unavailable", "不可用"), path: "/office/doc",
        },
        {
          id: "mail", name: t("office.mail", "邮件"), icon: MailIcon,
          description: "", status: "inactive", statusText: t("office.unavailable", "不可用"), path: "/office/mail",
        },
        {
          id: "calendar", name: t("office.calendar", "日历"), icon: CalendarIcon,
          description: "", status: "inactive", statusText: t("office.unavailable", "不可用"), path: "/office/calendar",
        },
      ]);
    }
  }

  function navigateTo(path: string) {
    // 使用 window.location 进行简单导航
    // 后续可替换为 react-router useNavigate
    window.location.hash = path;
  }

  const statusColors: Record<string, string> = {
    active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    inactive: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  };

  return (
    <div className="h-full overflow-y-auto bg-white dark:bg-gray-950">
      <div className="max-w-4xl mx-auto p-6">
        {/* 页面标题 */}
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {t("office.title", "办公")}
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mb-8">
          {t("office.subtitle", "智能化办公——文档创建、邮件收发、日历管理")}
        </p>

        {/* 模块卡片网格 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {modules.map((mod) => {
            const IconComp = mod.icon;
            return (
              <div
                key={mod.id}
                onClick={() => navigateTo(mod.path)}
                className="border border-gray-200 dark:border-gray-700 rounded-xl p-5 cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                    <IconComp className="text-blue-600 dark:text-blue-400" size={20} />
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-900 dark:text-white">{mod.name}</h2>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[mod.status]}`}>
                      {mod.statusText}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">{mod.description}</p>
              </div>
            );
          })}
        </div>

        {/* 快速操作 */}
        <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-900 rounded-xl">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            {t("office.quickActions", "快速操作")}
          </h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => navigateTo("/office/doc")}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {t("office.createDoc", "创建文档")}
            </button>
            <button
              onClick={() => navigateTo("/office/mail")}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {t("office.sendMail", "写邮件")}
            </button>
            <button
              onClick={() => navigateTo("/office/calendar")}
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
