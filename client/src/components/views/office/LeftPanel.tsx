/**
 * LeftPanel — 左栏功能区（25%）
 * 包含 TopBar、QuickCreateCards、FileList、SubModuleBar
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useOfficeStore } from "../../../stores/officeStore";
import { QuickCreateCards } from "./QuickCreateCards";
import { FileList } from "./FileList";
import { SubModuleBar } from "./SubModuleBar";
import { ErrorBoundary } from "./components/ErrorBoundary";

export function LeftPanel() {
  const { t } = useTranslation();
  const docStatus = useOfficeStore((s) => s.docStatus);
  const setGenerationStatus = useOfficeStore((s) => s.setGenerationStatus);

  /** QuickCreate 卡片点击 → 聚焦 ChatInput 并填入提示词 */
  const handleCardClick = useCallback(
    (prompt: string) => {
      const chatInput = document.querySelector<HTMLTextAreaElement>(
        "[data-office-chat-input]",
      );
      if (chatInput) {
        chatInput.focus();
        chatInput.value = prompt;
        // 触发 input 事件以便框架感知变更
        chatInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      setGenerationStatus({ active: false });
    },
    [setGenerationStatus],
  );

  const connected = docStatus === "active";

  return (
    <div
      className="h-full flex flex-col border-r border-gray-200 dark:border-gray-700 
        bg-gray-50 dark:bg-gray-950"
      role="region"
      aria-label={t("office.leftPanel", "功能区")}
    >
      {/* TopBar: 标题 + 连接状态 tooltip */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t("office.title", "办公")}
        </h2>
        <span
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: connected ? "#22c55e" : "#ef4444" }}
          title={
            connected
              ? t("office.connected", "OfficeCLI 已连接")
              : t("office.notConnected", "OfficeCLI 未连接")
          }
          aria-label={
            connected
              ? t("office.connected", "OfficeCLI 已连接")
              : t("office.notConnected", "OfficeCLI 未连接")
          }
        />
      </div>

      {/* QuickCreate 区域 */}
      <div className="px-2 pt-3 pb-2">
        <QuickCreateCards onCardClick={handleCardClick} />
      </div>

      {/* 文件列表区域 */}
      <div className="flex-1 min-h-0 border-t border-gray-200 dark:border-gray-700 pt-2">
        <ErrorBoundary message={t("office.fileListError", "文件列表加载失败")}>
          <FileList />
        </ErrorBoundary>
      </div>

      {/* 子模块栏（邮件/日历） */}
      <ErrorBoundary message={t("office.subModuleError", "子模块加载失败")}>
        <SubModuleBar />
      </ErrorBoundary>
    </div>
  );
}
