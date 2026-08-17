/**
 * OfficeMailPage — 邮件管理子页面
 * 全宽两栏布局：左侧邮箱操作区 + 右侧邮件列表/详情
 */

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MailIcon } from "../../../assets/icons/navigation";
import { officeService } from "../../../services/officeService";
import { useOfficeStore } from "../../../stores/officeStore";
import type { MailItem } from "../../../types/office";

export default function OfficeMailPage() {
  const { t } = useTranslation();
  const {
    mailConfigured,
    setMailConfigured,
    mailList,
    setMailList,
    mailSentList,
    setMailSentList,
  } = useOfficeStore();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"inbox" | "sent">("inbox");
  const [showCompose, setShowCompose] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMail, setSelectedMail] = useState<MailItem | null>(null);

  // 配置表单
  const [provider, setProvider] = useState("gmail");
  const [authMethod, setAuthMethod] = useState("password");
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("");

  // 写邮件表单
  const [mailTo, setMailTo] = useState("");
  const [mailSubject, setMailSubject] = useState("");
  const [mailBody, setMailBody] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    initMailPage().finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  async function initMailPage() {
    try {
      const statusRes = await officeService.getMailStatus();
      const configured =
        (statusRes as unknown as Record<string, unknown>)?.ok !== false;
      setMailConfigured(configured);
      if (configured) {
        try {
          const configRes = await officeService.getMailConfig();
          const data = (configRes as unknown as Record<string, unknown>)
            ?.data as Record<string, unknown>;
          const accounts = (data?.data as Record<string, unknown>)?.accounts as
            Array<Record<string, unknown>> | undefined;
          if (accounts?.length) {
            setProvider((accounts[0].provider as string) || "gmail");
            setAuthMethod((accounts[0].authMethod as string) || "password");
            setEmailAddress((accounts[0].user as string) || "");
          }
        } catch {
          /* 配置读取失败 */
        }
        fetchMailList();
      }
    } catch {
      setError(t("office.mailStatusError", "获取邮件状态失败"));
    }
  }

  async function fetchMailList() {
    try {
      if (searchQuery) {
        const res = await officeService.searchMail(searchQuery);
        const data = (res as unknown as Record<string, unknown>)
          ?.data as Record<string, unknown>;
        setMailList(
          ((data?.data as Record<string, unknown>)?.mails as MailItem[]) ?? [],
        );
      } else if (activeTab === "inbox") {
        const res = await officeService.getMailInbox();
        const data = (res as unknown as Record<string, unknown>)
          ?.data as Record<string, unknown>;
        setMailList(
          ((data?.data as Record<string, unknown>)?.mails as MailItem[]) ?? [],
        );
      } else {
        const res = await officeService.getMailSent();
        const data = (res as unknown as Record<string, unknown>)
          ?.data as Record<string, unknown>;
        setMailSentList(
          ((data?.data as Record<string, unknown>)?.mails as MailItem[]) ?? [],
        );
      }
    } catch {
      /* ignored */
    }
  }

  useEffect(() => {
    if (mailConfigured && !loading) fetchMailList();
  }, [activeTab, searchQuery]);

  async function handleSaveConfig() {
    if (!emailAddress || !password) {
      setError("邮箱地址和密码不能为空");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await officeService.saveMailConfig({
        provider,
        authMethod,
        emailAddress,
        password,
        smtpHost: smtpHost || undefined,
        smtpPort: smtpPort ? Number(smtpPort) : undefined,
        imapHost: imapHost || undefined,
        imapPort: imapPort ? Number(imapPort) : undefined,
      });
      if ((res as unknown as Record<string, unknown>)?.ok === false) {
        setError(t("office.mailConfigSaveError", "配置失败"));
      } else {
        setMailConfigured(true);
        setPassword("");
        setError(null);
        initMailPage();
      }
    } catch {
      setError(t("office.mailNetworkError", "网络错误"));
    } finally {
      setSaving(false);
    }
  }

  async function handleSendMail() {
    if (!mailTo || !mailSubject || !mailBody) return;
    setSaving(true);
    setError(null);
    try {
      // G-6 修复：检查响应 ok，避免发送失败（如 400 密文 AUTH 失败）仍被当作成功
      const res = await officeService.sendMail({
        to: mailTo,
        subject: mailSubject,
        body: mailBody,
      });
      if (res?.ok === false) {
        setError(
          (res.error as unknown as { message?: string })?.message ||
            t("office.mailSendError", "发送失败"),
        );
        return;
      }
      setShowCompose(false);
      setMailTo("");
      setMailSubject("");
      setMailBody("");
      initMailPage();
    } catch {
      setError(t("office.mailSendError", "发送失败"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteMail(id: string) {
    try {
      const res = await officeService.deleteMail(id);
      if (res?.ok === false) {
        setError(
          (res.error as unknown as { message?: string })?.message ||
            t("office.mailDeleteError", "删除失败"),
        );
        return;
      }
      fetchMailList();
      setSelectedMail(null);
    } catch {
      setError(t("office.mailDeleteError", "删除失败"));
    }
  }

  const currentMails = activeTab === "sent" ? mailSentList : mailList;

  return (
    <div className="h-full w-full min-h-0 flex bg-white dark:bg-gray-950">
      {/* 左侧操作区 */}
      <div className="w-[280px] flex-shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-gray-50 dark:bg-gray-950">
        {/* 返回按钮 */}
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

        {/* 标题 */}
        <div className="flex items-center gap-2 px-3 py-3">
          <MailIcon className="text-blue-600 dark:text-blue-400" size={20} />
          <span className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("office.mail", "邮件")}
          </span>
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${mailConfigured ? "bg-green-500" : "bg-red-500"}`}
            title={
              mailConfigured
                ? t("office.configured", "已配置")
                : t("office.notConfigured", "未配置")
            }
          />
        </div>

        {/* 配置区域（未配置时显示） */}
        {!mailConfigured && (
          <div className="px-3 py-2 space-y-2 flex-1 overflow-y-auto">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              {t("office.mailConfig", "邮箱配置")}
            </h3>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            >
              <option value="gmail">Gmail</option>
              <option value="outlook">Outlook</option>
              <option value="custom">SMTP/IMAP 自定义</option>
            </select>
            <input
              type="email"
              value={emailAddress}
              onChange={(e) => setEmailAddress(e.target.value)}
              placeholder={t("office.emailAddress", "邮箱地址")}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("office.mailPasswordPlaceholder", "密码或授权码")}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
            {provider === "custom" && (
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="SMTP 主机"
                  className="border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
                <input
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(e.target.value)}
                  placeholder="587"
                  className="border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
                <input
                  value={imapHost}
                  onChange={(e) => setImapHost(e.target.value)}
                  placeholder="IMAP 主机"
                  className="border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
                <input
                  value={imapPort}
                  onChange={(e) => setImapPort(e.target.value)}
                  placeholder="993"
                  className="border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
              </div>
            )}
            <button
              onClick={handleSaveConfig}
              disabled={saving}
              className="w-full px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving
                ? t("office.mailSaving", "保存中...")
                : t("office.mailSaveConfig", "配置邮箱")}
            </button>
          </div>
        )}

        {/* 已配置：操作按钮 */}
        {mailConfigured && (
          <div className="px-2 py-2 space-y-1">
            <button
              onClick={() => {
                setActiveTab("inbox");
                setSelectedMail(null);
              }}
              className={`w-full text-left px-2 py-1.5 text-sm rounded-lg transition-colors ${activeTab === "inbox" ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium" : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
            >
              📥 {t("office.inbox", "收件箱")}
            </button>
            <button
              onClick={() => {
                setActiveTab("sent");
                setSelectedMail(null);
              }}
              className={`w-full text-left px-2 py-1.5 text-sm rounded-lg transition-colors ${activeTab === "sent" ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium" : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
            >
              📤 {t("office.mailSentTab", "已发送")}
            </button>
            <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
            <button
              onClick={() => setShowCompose(!showCompose)}
              className="w-full px-2 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              ✏️ {t("office.mailCompose", "写邮件")}
            </button>
            <button
              onClick={() => {
                fetchMailList();
              }}
              className="w-full px-2 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              🔄 {t("office.mailRefresh", "刷新")}
            </button>
          </div>
        )}

        {/* 搜索框（已配置时显示） */}
        {mailConfigured && (
          <div className="px-2 pb-2">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("office.mailSearchPlaceholder", "搜索邮件...")}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </div>
        )}
      </div>

      {/* 右侧内容区 */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* 错误提示 */}
        {error && (
          <div className="mx-4 mt-3 p-2 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 underline">
              {t("office.close", "关闭")}
            </button>
          </div>
        )}

        {/* 写邮件表单 */}
        {showCompose && (
          <div className="border-b border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-900">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              {t("office.mailCompose", "写邮件")}
            </h3>
            <div className="space-y-2">
              <input
                value={mailTo}
                onChange={(e) => setMailTo(e.target.value)}
                placeholder={t("office.mailTo", "收件人")}
                type="email"
                className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
              <input
                value={mailSubject}
                onChange={(e) => setMailSubject(e.target.value)}
                placeholder={t("office.mailSubject", "主题")}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
              <textarea
                value={mailBody}
                onChange={(e) => setMailBody(e.target.value)}
                placeholder={t("office.mailBody", "正文")}
                rows={4}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSendMail}
                  disabled={saving}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving
                    ? t("office.mailSending", "发送中...")
                    : t("office.mailSend", "发送")}
                </button>
                <button
                  onClick={() => setShowCompose(false)}
                  className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  {t("office.cancel", "取消")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 邮件列表或空状态 */}
        {!mailConfigured ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <MailIcon
                className="mx-auto mb-3 text-gray-300 dark:text-gray-600"
                size={48}
              />
              <p className="text-sm">
                {t("office.mailConfigPrompt", "请先配置邮箱以查看邮件")}
              </p>
            </div>
          </div>
        ) : selectedMail ? (
          /* 邮件详情 */
          <div className="flex-1 overflow-y-auto p-4">
            <button
              onClick={() => setSelectedMail(null)}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-3 inline-flex items-center gap-1"
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
              {t("office.backToList", "返回列表")}
            </button>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              {selectedMail.subject}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              {t("office.mailFrom", "发件人")}: {selectedMail.from} ·{" "}
              {selectedMail.date}
            </p>
            <div className="border-t border-gray-200 dark:border-gray-700 pt-3 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
              {selectedMail.snippet ?? selectedMail.subject}
            </div>
            {activeTab === "inbox" && (
              <button
                onClick={() =>
                  handleDeleteMail(
                    ((selectedMail as unknown as Record<string, unknown>)
                      .uid as string) || selectedMail.subject,
                  )
                }
                className="mt-4 text-xs text-red-500 hover:text-red-700"
              >
                {t("office.mailDelete", "删除")}
              </button>
            )}
          </div>
        ) : currentMails.length > 0 ? (
          /* 邮件列表 */
          <div className="flex-1 overflow-y-auto">
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {currentMails.map((mail, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedMail(mail)}
                  className="w-full text-left flex items-center gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
                >
                  <MailIcon className="text-blue-500 shrink-0" size={18} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {mail.subject}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {mail.from} · {mail.date}
                    </div>
                  </div>
                  {activeTab === "inbox" && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteMail(
                          ((mail as unknown as Record<string, unknown>)
                            .uid as string) || mail.subject,
                        );
                      }}
                      className="text-xs text-red-400 hover:text-red-600 shrink-0 px-1"
                    >
                      🗑️
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-gray-400">
              {activeTab === "inbox"
                ? t("office.mailNoInbox", "暂无邮件")
                : t("office.mailNoSent", "暂无已发送邮件")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
