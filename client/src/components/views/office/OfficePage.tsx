/**
 * OfficePage — 办公模块入口页面
 * 展示 doc/mail/calendar 三个子模块的状态和入口
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DocIcon, MailIcon, CalendarIcon } from "../../../assets/icons/navigation";
import { ModuleCard } from "./components/ModuleCard";
import type { ModuleCardStatus } from "./components/OfficeStatusBadge";

/** 模块状态卡片 */
interface ModuleStatus {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  description: string;
  status: ModuleCardStatus;
  statusText: string;
  path: string;
}

export default function OfficePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [modules, setModules] = useState<ModuleStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetchOfficeStatus(controller.signal).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  /** 获取各办公模块的连接状态 */
  async function fetchOfficeStatus(signal?: AbortSignal) {
    try {
      const [docRes, mailRes, calRes] = await Promise.all([
        fetch("/v1/doc/status", { signal }).catch(() => null),
        fetch("/v1/mail/status", { signal }).catch(() => null),
        fetch("/v1/calendar/status", { signal }).catch(() => null),
      ]);

      if (signal?.aborted) return;

      // 从 API 响应中读取 officeCliInfo.installed，而非仅依赖 HTTP 状态码
      // （后端 DEGRADED 模式也返回 200，所以 docRes?.ok 不能反映真实安装状态）
      let docInstalled = false;
      if (docRes?.ok) {
        try {
          const docData = await docRes.json();
          docInstalled = docData?.officeCliInfo?.installed === true;
        } catch {
          // 解析失败时保持 false
        }
      }

      setModules([
        {
          id: "doc",
          name: t("office.doc", "文档"),
          icon: DocIcon,
          description: t("office.docDesc", "基于 OfficeCLI 的 Word/Excel/PPT 文档创建与编辑"),
          status: docInstalled ? "active" : "degraded",
          statusText: docInstalled ? t("office.connected", "已连接") : t("office.notInstalled", "未安装 OfficeCLI"),
          path: "/office/doc",
        },
        {
          id: "mail",
          name: t("office.mail", "邮件"),
          icon: MailIcon,
          description: t("office.mailDesc", "SMTP/IMAP 邮件收发，支持 OAuth2 认证"),
          status: mailRes?.ok ? "active" : "degraded",
          statusText: mailRes?.ok ? t("office.configured", "已配置") : t("office.notConfigured", "未配置"),
          path: "/office/mail",
        },
        {
          id: "calendar",
          name: t("office.calendar", "日历"),
          icon: CalendarIcon,
          description: t("office.calendarDesc", "日程管理与事件提醒"),
          status: calRes?.ok ? "active" : "degraded",
          statusText: calRes?.ok ? t("office.ready", "就绪") : t("office.notReady", "未就绪"),
          path: "/office/calendar",
        },
      ]);
    } catch {
      if (signal?.aborted) return;
      // 后端不可用时显示占位
      setModules([
        {
          id: "doc", name: t("office.doc", "文档"), icon: DocIcon,
          description: t("office.unavailable", "后端服务不可用，请检查 Liri 是否已启动"),
          status: "inactive", statusText: t("office.unavailable", "不可用"), path: "/office/doc",
        },
        {
          id: "mail", name: t("office.mail", "邮件"), icon: MailIcon,
          description: t("office.unavailable", "后端服务不可用，请检查 Liri 是否已启动"),
          status: "inactive", statusText: t("office.unavailable", "不可用"), path: "/office/mail",
        },
        {
          id: "calendar", name: t("office.calendar", "日历"), icon: CalendarIcon,
          description: t("office.unavailable", "后端服务不可用，请检查 Liri 是否已启动"),
          status: "inactive", statusText: t("office.unavailable", "不可用"), path: "/office/calendar",
        },
      ]);
    }
  }

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
        {loading ? (
          /* 骨架屏 */
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-xl p-5 animate-pulse">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-lg" />
                  <div className="flex-1">
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20 mb-2" />
                    <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-16" />
                  </div>
                </div>
                <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {modules.map((mod) => (
              <ModuleCard key={mod.id} {...mod} />
            ))}
          </div>
        )}

        {/* 快速操作 */}
        <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-900 rounded-xl">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            {t("office.quickActions", "快速操作")}
          </h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => navigate("/office/doc")}
              disabled={loading}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                loading
                  ? "bg-gray-400 text-white cursor-not-allowed"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              }`}
            >
              {t("office.createDoc", "创建文档")}
            </button>
            <button
              onClick={() => navigate("/office/mail")}
              disabled={loading}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                loading
                  ? "bg-gray-400 text-white cursor-not-allowed"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              }`}
            >
              {t("office.sendMail", "写邮件")}
            </button>
            <button
              onClick={() => navigate("/office/calendar")}
              disabled={loading}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                loading
                  ? "bg-gray-400 text-white cursor-not-allowed"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              }`}
            >
              {t("office.addEvent", "添加日程")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}