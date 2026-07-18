/**
 * OfficeDocPage — 文档管理子页面
 * 展示 OfficeCLI 状态、文档列表、可用模板（来自 /v1/doc/status 真实 API）
 */

import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DocIcon } from "../../../assets/icons/navigation";

/** 模板名称 → 中文显示名映射 */
const TEMPLATE_DISPLAY_NAMES: Record<string, string> = {
  "weekly-report": "周报",
  "meeting-minutes": "会议纪要",
  "tech-design": "技术设计",
  "prd": "PRD",
};

/** API 返回的文档列表项 */
interface ApiDocItem {
  name: string;
  size: number;
  mtime: number;
}

/** API 返回的完整响应 */
interface DocStatusResponse {
  status?: string;
  officeCliInfo?: { installed?: boolean; version?: string };
  templateCount?: number;
  templates?: string[];
  documents?: ApiDocItem[];
}

export default function OfficeDocPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  /** OfficeCLI 连接状态 */
  const [officeCliVersion, setOfficeCliVersion] = useState<string | null>(null);
  /** 模板名称列表（来自 API） */
  const [templateNames, setTemplateNames] = useState<string[]>([]);
  /** 文档列表（来自 API） */
  const [docs, setDocs] = useState<ApiDocItem[]>([]);
  /** 加载状态 */
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetchDocStatus(controller.signal).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  /** 获取文档模块状态（从 /v1/doc/status 真实 API） */
  async function fetchDocStatus(signal?: AbortSignal) {
    try {
      const res = await fetch("/v1/doc/status", { signal });
      if (res.ok) {
        const data: DocStatusResponse = await res.json();
        setOfficeCliVersion(data?.officeCliInfo?.version ?? null);
        setTemplateNames(data?.templates ?? []);
        setDocs(data?.documents ?? []);
      }
    } catch {
      // 后端不可用时留空，显示静态布局
    }
  }

  /** 格式化文件大小 */
  function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + "B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB";
    return (bytes / (1024 * 1024)).toFixed(1) + "MB";
  }

  /** 格式化时间戳 */
  function formatDate(mtime: number): string {
    const d = new Date(mtime);
    return `${d.getMonth() + 1}/${d.getDate()}`;
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

        {/* OfficeCLI 状态 */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
            <DocIcon className="text-blue-600 dark:text-blue-400" size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {t("office.doc", "文档")}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {loading
                ? "..."
                : officeCliVersion
                  ? `OfficeCLI ${t("office.connected", "已连接")} v${officeCliVersion}`
                  : t("office.notInstalled", "未安装 OfficeCLI")}
            </p>
          </div>
        </div>

        {/* OfficeCLI 未安装引导 */}
        {!loading && !officeCliVersion && (
          <div className="border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 rounded-xl p-5 mb-6">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-2">
                  {t("office.cliNotInstalledTitle", "OfficeCLI 未安装")}
                </h3>
                <p className="text-xs text-amber-700 dark:text-amber-300 mb-3">
                  {t("office.cliNotInstalledDesc", "OfficeCLI 是文档创建和编辑所需的命令行工具。请按以下步骤安装：")}
                </p>
                <div className="bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-3">
                  <p className="text-xs font-mono text-gray-700 dark:text-gray-300 mb-1">
                    {t("office.cliStep1", "1. 打开 PowerShell（管理员）")}
                  </p>
                  <p className="text-xs font-mono text-gray-700 dark:text-gray-300 mb-1">
                    {t("office.cliStep2", "2. 进入 OfficeCLI 目录：")}
                  </p>
                  <code className="block text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-blue-700 dark:text-blue-300 mb-2">
                    cd BA_REF\OfficeCLI-main
                  </code>
                  <p className="text-xs font-mono text-gray-700 dark:text-gray-300 mb-1">
                    {t("office.cliStep3", "3. 执行安装脚本：")}
                  </p>
                  <code className="block text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-blue-700 dark:text-blue-300">
                    .\install.ps1
                  </code>
                </div>
                <button
                  onClick={() => { setLoading(true); fetchDocStatus(); }}
                  className="px-3 py-1.5 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
                >
                  {t("office.retryDetect", "重新检测")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 快速创建 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <button
            onClick={() => navigate("/office/doc")}
            className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-left
              hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md hover:scale-[1.02]
              active:scale-[0.98] transition-all duration-200 ease-in-out"
          >
            <div className="text-lg mb-1">{t("office.createDoc", "创建文档")}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {t("office.createDocDesc", "新建 .docx 文档")}
            </div>
          </button>
          <button
            onClick={() => navigate("/office/doc")}
            className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-left
              hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md hover:scale-[1.02]
              active:scale-[0.98] transition-all duration-200 ease-in-out"
          >
            <div className="text-lg mb-1">{t("office.createSheet", "创建表格")}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {t("office.createSheetDesc", "新建 .xlsx 表格")}
            </div>
          </button>
          <button
            onClick={() => navigate("/office/doc")}
            className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-left
              hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md hover:scale-[1.02]
              active:scale-[0.98] transition-all duration-200 ease-in-out"
          >
            <div className="text-lg mb-1">{t("office.createSlide", "创建演示")}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {t("office.createSlideDesc", "新建 .pptx 演示")}
            </div>
          </button>
        </div>

        {/* 文档列表 */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            {t("office.docList", "文档列表")}
          </h2>
          {docs.length > 0 ? (
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl divide-y divide-gray-100 dark:divide-gray-800">
              {docs.map((doc, i) => (
                <div key={i} className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-3">
                    <DocIcon className="text-blue-500" size={18} />
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{doc.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {formatSize(doc.size)} · {formatDate(doc.mtime)}
                      </div>
                    </div>
                  </div>
                  <button className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                    {t("office.download", "下载")}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-8 text-center text-sm text-gray-400">
              {t("office.noDocuments", "暂无文档，创建第一个文档开始使用")}
            </div>
          )}
        </div>

        {/* 可用模板 */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            {t("office.availableTemplates", "可用模板")}: {templateNames.length} {t("office.templatesUnit", "个")}
          </h2>
          {templateNames.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {templateNames.map((name) => (
                <span
                  key={name}
                  className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-full"
                >
                  {TEMPLATE_DISPLAY_NAMES[name] ?? name}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-400">{t("office.noDocuments", "暂无可用模板")}</div>
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
