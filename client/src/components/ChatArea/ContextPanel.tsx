import { useTranslation } from "react-i18next";
import type { FilePreview } from "../../types";

interface ContextPanelProps {
  /** 面板是否展开 */
  isOpen: boolean;
  /** 切换面板 */
  onToggle: () => void;
  /** 当前会话文件列表 */
  sessionFiles: FilePreview[];
  /** 会话用量统计 */
  sessionUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd?: number;
  };
}

/**
 * ContextPanel — 聊天右侧上下文面板
 *
 * 可折叠面板，显示当前会话引用的文件列表和 Token 用量统计。
 * 折叠时显示为右侧边缘的细条切换按钮，展开时滑出 260px 面板。
 */
export default function ContextPanel({
  isOpen,
  onToggle,
  sessionFiles,
  sessionUsage,
}: ContextPanelProps) {
  const { t } = useTranslation();

  /** 格式化文件大小 */
  const formatSize = (bytes?: number) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  /** 文件类型图标 */
  const fileIcon = (type?: string) => {
    if (!type) return "📄";
    if (type === "image") return "🖼️";
    if (type === "code" || type?.startsWith("text/")) return "📝";
    return "📄";
  };

  return (
    <div
      className={`flex-shrink-0 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 transition-all duration-300 overflow-hidden ${
        isOpen ? "w-[260px]" : "w-[36px]"
      }`}
    >
      {/* 折叠/展开按钮 */}
      <button
        onClick={onToggle}
        className="w-full h-10 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        title={isOpen ? t("chat.collapsePanel") : t("chat.expandPanel")}
        aria-label={isOpen ? t("chat.collapsePanel") : t("chat.expandPanel")}
      >
        <svg
          className={`w-4 h-4 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {isOpen && (
        <div className="px-3 py-2 h-full overflow-y-auto">
          {/* Token 用量统计 */}
          {sessionUsage && sessionUsage.totalTokens > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                {t("chat.tokenUsage")}
              </h3>
              <div className="space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
                <div className="flex justify-between">
                  <span>{t("chat.inputTokens")}</span>
                  <span className="font-mono">{sessionUsage.inputTokens.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>{t("chat.outputTokens")}</span>
                  <span className="font-mono">{sessionUsage.outputTokens.toLocaleString()}</span>
                </div>
                <div className="flex justify-between font-medium text-gray-800 dark:text-gray-200 border-t border-gray-100 dark:border-gray-800 pt-1.5 mt-1">
                  <span>{t("chat.totalTokens")}</span>
                  <span className="font-mono">{sessionUsage.totalTokens.toLocaleString()}</span>
                </div>
                {sessionUsage.estimatedCostUsd != null && sessionUsage.estimatedCostUsd > 0 && (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                    <span>{t("chat.cost")}</span>
                    <span className="font-mono">${sessionUsage.estimatedCostUsd.toFixed(4)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 会话文件列表 */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              {t("chat.sessionFiles")} ({sessionFiles.length})
            </h3>
            {sessionFiles.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                {t("chat.noSessionFiles")}
              </p>
            ) : (
              <div className="space-y-1">
                {sessionFiles.map((file) => (
                  <div
                    key={file.path}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
                    title={file.path}
                  >
                    <span className="text-sm shrink-0">{fileIcon(file.type)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-gray-700 dark:text-gray-300 truncate">
                        {file.name}
                      </div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate font-mono">
                        {file.path}
                      </div>
                    </div>
                    {file.size && (
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
                        {formatSize(file.size)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 快捷提示 */}
          <div className="mt-4 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <p className="text-[10px] text-blue-600 dark:text-blue-400 leading-relaxed">
              {t("chat.contextPanelHint")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
