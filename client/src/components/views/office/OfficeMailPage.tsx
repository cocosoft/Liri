/**
 * OfficeMailPage — 邮件管理子页面
 * 展示邮箱配置、快捷操作、最近邮件
 */

import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MailIcon } from "../../../assets/icons/navigation";

/** 邮件列表项 */
interface MailItem {
  subject: string;
  from: string;
  date: string;
}

export default function OfficeMailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  /** 邮箱是否已配置 */
  const [configured, setConfigured] = useState<boolean | null>(null);
  /** 最近邮件列表（第二轮接入真实 API） */
  const [mails] = useState<MailItem[]>([]);
  /** 加载状态 */
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetchMailStatus(controller.signal).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  /** 获取邮件模块状态 */
  async function fetchMailStatus(signal?: AbortSignal) {
    try {
      const res = await fetch("/v1/mail/status", { signal });
      if (res.ok) {
        setConfigured(true);
      } else {
        setConfigured(false);
      }
    } catch {
      setConfigured(null);
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

        {/* 邮箱状态 */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
            <MailIcon className="text-blue-600 dark:text-blue-400" size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {t("office.mail", "邮件")}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {loading
                ? "..."
                : configured === true
                  ? t("office.configured", "已配置")
                  : t("office.notConfigured", "未配置")}
            </p>
          </div>
        </div>

        {/* 邮箱配置 */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
            {t("office.mailConfig", "邮箱配置")}
          </h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t("office.provider", "提供商")}
              </label>
              <select
                className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                defaultValue="gmail"
              >
                <option value="gmail">Gmail</option>
                <option value="outlook">Outlook</option>
                <option value="custom">SMTP/IMAP 自定义</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t("office.authMethod", "认证方式")}
              </label>
              <select
                className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                defaultValue="oauth2"
              >
                <option value="oauth2">OAuth2</option>
                <option value="password">应用密码</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t("office.emailAddress", "邮箱地址")}
              </label>
              <input
                type="email"
                placeholder="user@example.com"
                className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            <button className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              {t("office.configure", "配置邮箱")}
            </button>
          </div>
        </div>

        {/* 快捷操作 */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => navigate("/office/mail")}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {t("office.sendMail", "写邮件")}
          </button>
          <button
            onClick={() => navigate("/office/mail")}
            className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            {t("office.inbox", "收件箱")}
          </button>
          <button
            onClick={() => navigate("/office/mail")}
            className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            {t("office.search", "搜索")}
          </button>
        </div>

        {/* 最近邮件 */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            {t("office.recentMail", "最近邮件")}
          </h2>
          {mails.length > 0 ? (
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl divide-y divide-gray-100 dark:divide-gray-800">
              {mails.map((mail, i) => (
                <div key={i} className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-3">
                    <MailIcon className="text-blue-500" size={18} />
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{mail.subject}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{mail.from} · {mail.date}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-8 text-center text-sm text-gray-400">
              {configured
                ? t("office.noMail", "暂无邮件")
                : t("office.configureMailPrompt", "请先配置邮箱以查看邮件")}
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
