/**
 * OfficeDocPage — 文档管理子页面
 * 模板卡片、最近文档、一键创建（连通 AI 聊天）、安装引导
 */

import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DocIcon } from "../../../assets/icons/navigation";
import { officeService } from "../../../services/officeService";
import { useOfficeStore } from "../../../stores/officeStore";
import { useChatStore } from "../../../stores/chatStore";
import CreateDocModal from "./CreateDocModal";

interface TemplateDef {
  id: string;
  name: string;
  icon: string;
  scenario: string;
  prompt: string;
  inputs: string;
}

const TEMPLATES: TemplateDef[] = [
  {
    id: "weekly-report",
    name: "周报",
    icon: "📋",
    scenario: "本周工作总结与下周计划",
    prompt:
      "请用周报模板帮我创建本周工作总结文档，包括：\n1. 本周完成的工作\n2. 遇到的问题及解决方案\n3. 下周工作计划",
    inputs: "工作事项列表",
  },
  {
    id: "meeting-minutes",
    name: "会议纪要",
    icon: "📝",
    scenario: "会议记录、决议跟踪",
    prompt:
      "请用会议纪要模板帮我创建会议记录，包括：\n1. 会议主题\n2. 参会人员\n3. 讨论要点\n4. 决议事项\n5. 待办任务",
    inputs: "会议信息",
  },
  {
    id: "tech-design",
    name: "技术设计",
    icon: "⚙️",
    scenario: "技术方案设计文档",
    prompt:
      "请用技术设计模板帮我创建技术方案，包括：\n1. 背景与目标\n2. 技术选型\n3. 架构设计\n4. 接口定义\n5. 风险评估",
    inputs: "设计概要",
  },
  {
    id: "prd",
    name: "PRD",
    icon: "📄",
    scenario: "产品需求文档",
    prompt:
      "请用 PRD 模板帮我创建产品需求文档，包括：\n1. 产品背景\n2. 用户场景\n3. 功能需求\n4. 非功能需求\n5. 验收标准",
    inputs: "需求要点",
  },
];

export default function OfficeDocPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { docStatus, fileList, docTemplates, setDocStatus } = useOfficeStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingTemplate, setCreatingTemplate] = useState<string | null>(null);
  const [sendingToChat, setSendingToChat] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createModalType, setCreateModalType] = useState<
    "docx" | "xlsx" | "pptx"
  >("docx");

  useEffect(() => {
    fetchDocStatus().finally(() => setLoading(false));
  }, []);

  async function fetchDocStatus() {
    try {
      const res = await officeService.getDocStatus();
      if ((res as any)?.ok === false) {
        setError(t("office.docStatusError", "获取文档状态失败"));
        return;
      }
      const data = (res as any)?.data?.data || (res as any)?.data || {};
      setDocStatus(
        data?.officeCliInfo?.installed ? "active" : "degraded",
        data?.templates ?? [],
        data?.documents ?? [],
      );
    } catch {
      setError(t("office.docStatusError", "后端不可用，请检查服务是否启动"));
    }
  }

  async function handleCreateViaAI(template?: TemplateDef) {
    if (docStatus !== "active") {
      setCreateModalType("docx");
      setShowCreateModal(true);
      return;
    }
    setCreatingTemplate(template?.id ?? null);
    setSendingToChat(true);
    try {
      const prompt = template ? template.prompt : "请帮我创建一份文档（.docx）";
      await useChatStore.getState().sendMessage(prompt);
      navigate("/chat");
    } catch {
      setError(t("office.docCreateError", "创建失败，请稍后在聊天界面中重试"));
    } finally {
      setSendingToChat(false);
      setCreatingTemplate(null);
    }
  }

  async function handleCreateExcel() {
    if (docStatus !== "active") {
      setCreateModalType("xlsx");
      setShowCreateModal(true);
      return;
    }
    setSendingToChat(true);
    try {
      await useChatStore
        .getState()
        .sendMessage(
          "请帮我创建一份 Excel 电子表格（.xlsx），包含合适的列标题和示例数据",
        );
      navigate("/chat");
    } catch {
      setError(t("office.docCreateError"));
    } finally {
      setSendingToChat(false);
    }
  }

  async function handleCreatePptx() {
    if (docStatus !== "active") {
      setCreateModalType("pptx");
      setShowCreateModal(true);
      return;
    }
    setSendingToChat(true);
    try {
      await useChatStore
        .getState()
        .sendMessage(
          "请帮我创建一份演示文稿（.pptx），包含标题页、内容页和图表",
        );
      navigate("/chat");
    } catch {
      setError(t("office.docCreateError"));
    } finally {
      setSendingToChat(false);
    }
  }

  /** 点击创建文档按钮（含状态检测） */
  function handleCreateDoc() {
    if (docStatus !== "active") {
      setCreateModalType("docx");
      setShowCreateModal(true);
      return;
    }
    handleCreateViaAI();
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + "B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB";
    return (bytes / (1024 * 1024)).toFixed(1) + "MB";
  }
  function formatDate(mtime: number): string {
    const d = new Date(mtime);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }

  return (
    <div className="h-full overflow-y-auto bg-white dark:bg-gray-950">
      <div className="max-w-4xl mx-auto p-6">
        <Link
          to="/office"
          className="inline-flex items-center text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 mb-4 transition-colors"
        >
          <svg
            className="w-4 h-4 mr-1"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {t("office.backToHome", "返回办公")}
        </Link>

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
                : docStatus === "active"
                  ? t("office.connected", "OfficeCLI 已连接")
                  : t(
                      "office.notInstalled",
                      "OfficeCLI 未安装 — 文档创建不可用",
                    )}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline">
              {t("office.close", "关闭")}
            </button>
          </div>
        )}

        {!loading && docStatus !== "active" && (
          <div className="border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 rounded-xl p-5 mb-6">
            <div className="flex items-start gap-3">
              <span className="text-xl mt-0.5 shrink-0">⚠️</span>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-2">
                  {t("office.cliNotInstalledTitle", "OfficeCLI 未安装")}
                </h3>
                <p className="text-xs text-amber-700 dark:text-amber-300 mb-3">
                  文档创建需要 OfficeCLI 命令行工具。请在
                  PowerShell（管理员）中运行：
                </p>
                <div className="bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-3 space-y-1">
                  <code className="block text-xs text-blue-700 dark:text-blue-300">
                    cd BA_REF\OfficeCLI-main
                  </code>
                  <code className="block text-xs text-blue-700 dark:text-blue-300">
                    .\install.ps1
                  </code>
                </div>
                <button
                  onClick={() => {
                    setLoading(true);
                    fetchDocStatus();
                  }}
                  className="px-3 py-1.5 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
                >
                  {t("office.retryDetect", "重新检测")}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            {t("office.quickActions", "快速创建")}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={handleCreateDoc}
              disabled={sendingToChat}
              className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-left hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 ease-in-out disabled:opacity-50"
            >
              <div className="text-lg mb-1">📄 .docx</div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                {t("office.createDoc", "创建文档")}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t("office.docCreateDocx", "Word 文档，AI 自动排版")}
              </div>
            </button>
            <button
              onClick={handleCreateExcel}
              disabled={sendingToChat}
              className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-left hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 ease-in-out disabled:opacity-50"
            >
              <div className="text-lg mb-1">📊 .xlsx</div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                {t("office.createSheet", "创建表格")}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t("office.docCreateXlsx", "Excel 电子表格，含表头和数据")}
              </div>
            </button>
            <button
              onClick={handleCreatePptx}
              disabled={sendingToChat}
              className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-left hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 ease-in-out disabled:opacity-50"
            >
              <div className="text-lg mb-1">📽️ .pptx</div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                {t("office.createSlide", "创建演示")}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t("office.docCreatePptx", "PowerPoint 演示，含标题和图表")}
              </div>
            </button>
          </div>
          {sendingToChat && (
            <div className="mt-2 text-xs text-blue-600 dark:text-blue-400 animate-pulse">
              {t("office.docCreating", "正在跳转到 AI 聊天界面...")}
            </div>
          )}
        </div>

        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            {t("office.docCreateFromTemplate", "从模板创建")}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {TEMPLATES.map((tmpl) => (
              <button
                key={tmpl.id}
                onClick={() => handleCreateViaAI(tmpl)}
                disabled={sendingToChat}
                className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-left hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{tmpl.icon}</span>
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    {tmpl.name}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  {tmpl.scenario}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  输入: {tmpl.inputs}
                </p>
                {creatingTemplate === tmpl.id && (
                  <div className="mt-2 text-xs text-blue-600 dark:text-blue-400 animate-pulse">
                    {t("office.docCreating", "正在跳转到 AI 聊天界面...")}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              {t("office.docList", "最近文档")} ({fileList.length})
            </h2>
            <button
              onClick={() => fetchDocStatus()}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t("office.docRefresh", "刷新")}
            </button>
          </div>
          {fileList.length > 0 ? (
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl divide-y divide-gray-100 dark:divide-gray-800">
              {fileList.map(
                (
                  doc: { name: string; size: number; mtime: number },
                  i: number,
                ) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <DocIcon className="text-blue-500 shrink-0" size={18} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {doc.name}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {formatSize(doc.size)} · {formatDate(doc.mtime)}
                        </div>
                      </div>
                    </div>
                    <a
                      href={`/v1/doc/download?file=${encodeURIComponent(doc.name)}`}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline shrink-0 ml-2"
                      download
                    >
                      {t("office.download", "下载")}
                    </a>
                    <button
                      onClick={() => navigate("/office")}
                      className="text-xs text-green-600 dark:text-green-400 hover:underline shrink-0 ml-2"
                    >
                      {t("office.preview", "预览")}
                    </button>
                  </div>
                ),
              )}
            </div>
          ) : (
            <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-8 text-center text-sm text-gray-400">
              {docStatus === "active"
                ? t("office.docNoDocActive", "暂无已生成文档")
                : t("office.docNoDocInactive", "安装 OfficeCLI 后即可创建文档")}
            </div>
          )}
        </div>

        {docTemplates.length > 0 && (
          <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-xl">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
              {t("office.docTemplatesBackend", "后端注册模板")}:{" "}
              {docTemplates.length} 个
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {docTemplates.map((name) => (
                <span
                  key={name}
                  className="px-2 py-0.5 text-xs bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-full border border-gray-200 dark:border-gray-700"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateDocModal
          defaultType={createModalType}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}
