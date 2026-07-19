/**
 * 办公模块键盘快捷键 hook（v6）
 * 集中管理所有快捷键，含 Escape 焦点判断
 */

import { useEffect } from "react";
import { useOfficeStore } from "../stores/officeStore";

/**
 * 注册办公模块全局快捷键
 * 在 OfficePage 挂载时调用一次
 */
export function useOfficeHotkeys() {
  const { selectFile, toggleRightPanel, selectedFile } = useOfficeStore();

  useEffect(() => {
    /**
     * 全局键盘事件处理
     * Escape 在 input/textarea 焦点中仅失焦，不关闭预览
     */
    function handleKeyDown(event: KeyboardEvent) {
      // Ctrl+N: 唤起 AI 创建文档（聚焦 ChatInput）
      if (event.ctrlKey && event.key === "n") {
        event.preventDefault();
        const chatInput = document.querySelector<HTMLTextAreaElement>(
          '[data-office-chat-input]',
        );
        chatInput?.focus();
        return;
      }

      // Ctrl+\: 切换右栏折叠
      if (event.ctrlKey && event.key === "\\") {
        event.preventDefault();
        toggleRightPanel();
        return;
      }

      // Escape: 关闭预览或仅失焦
      if (event.key === "Escape") {
        const active = document.activeElement;
        if (
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement
        ) {
          (active as HTMLElement).blur();
          return;
        }
        if (selectedFile) {
          selectFile(null);
        }
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectFile, toggleRightPanel, selectedFile]);
}
