/**
 * CreateDocModal — 文档创建模态框
 * 根据 DocModule 状态显示不同内容：
 * - degraded: OfficeCLI 安装引导
 * - full: 文档创建表单（引导到聊天界面）
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { officeService } from "../../../services/officeService";
import { useChatStore } from "../../../stores/chat";

interface CreateDocModalProps {
  /** 默认文档类型 */
  defaultType?: "docx" | "xlsx" | "pptx";
  onClose: () => void;
}

export default function CreateDocModal({
  defaultType = "docx",
  onClose,
}: CreateDocModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [type, setType] = useState(defaultType);
  const [template, setTemplate] = useState("");
  const [sending, setSending] = useState(false);
  const [statusCheck, setStatusCheck] = useState<
    "loading" | "ready" | "degraded"
  >("loading");

  // 进入时检查 OfficeCLI 状态
  useEffect(() => {
    officeService
      .getDocStatus()
      .then((res) => {
        const installed =
          (res as any)?.data?.data?.officeCliInfo?.installed ||
          (res as any)?.data?.officeCliInfo?.installed;
        setStatusCheck(installed ? "ready" : "degraded");
      })
      .catch(() => setStatusCheck("degraded"));
  }, []);

  /** 通过 AI 聊天创建文档 */
  async function handleCreate() {
    setSending(true);
    try {
      const prompts: Record<string, string> = {
        docx: "请帮我创建一份文档（.docx）",
        xlsx: "请帮我创建一份 Excel 电子表格（.xlsx），包含合适的列标题和示例数据",
        pptx: "请帮我创建一份演示文稿（.pptx），包含标题页、内容页和图表",
      };
      const prompt = template
        ? `请用"${template}"模板帮我创建一份${type}文档`
        : prompts[type] || prompts.docx;
      await useChatStore.getState().sendMessage(prompt);
      onClose();
      navigate("/chat");
    } catch {
      /* ignore */
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[480px] bg-white dark:bg-gray-950 rounded-xl overflow-hidden shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <span className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("office.docCreate", "创建文档")}
          </span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none p-1"
          >
            ✕
          </button>
        </div>

        <div className="p-5">
          {statusCheck === "loading" && (
            <div className="text-center py-8 text-gray-400 animate-pulse">
              {t("common.loading", "加载中...")}
            </div>
          )}

          {statusCheck === "degraded" && (
            <div className="text-center py-4">
              <span className="text-2xl mb-3 block">⚠️</span>
              <p className="text-sm text-amber-800 dark:text-amber-200 font-medium mb-2">
                {t("office.cliNotInstalledTitle", "OfficeCLI 未安装")}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mb-4">
                文档创建需要 OfficeCLI 命令行工具。请在
                PowerShell（管理员）中运行以下命令安装：
              </p>
              <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-3 mb-3 text-left">
                <code className="block text-xs text-blue-700 dark:text-blue-300">
                  cd BA_REF\OfficeCLI-main
                </code>
                <code className="block text-xs text-blue-700 dark:text-blue-300">
                  .\install.ps1
                </code>
              </div>
              <button
                onClick={onClose}
                className="px-4 py-2 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
              >
                {t("common.close", "关闭")}
              </button>
            </div>
          )}

          {statusCheck === "ready" && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  {t("office.docType", "文档类型")}
                </label>
                <div className="flex gap-2">
                  {(["docx", "xlsx", "pptx"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setType(t)}
                      className={`flex-1 px-3 py-2 text-sm border rounded-lg transition-colors ${
                        type === t
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
                          : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400"
                      }`}
                    >
                      .{t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  {t("office.docTemplate", "模板（可选）")}
                </label>
                <select
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                >
                  <option value="">无模板</option>
                  <option value="周报">周报</option>
                  <option value="会议纪要">会议纪要</option>
                  <option value="技术设计">技术设计</option>
                  <option value="PRD">PRD</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                >
                  {t("common.cancel", "取消")}
                </button>
                <button
                  onClick={handleCreate}
                  disabled={sending}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {sending
                    ? t("office.docCreating", "跳转中...")
                    : t("office.docCreate", "创建文档")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
