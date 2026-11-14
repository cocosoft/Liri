// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * FloatingPanel —— 全局悬浮窗内容（G8 一期，2026-11-14）
 *
 * 由 `main.tsx` 在 `?floating=1` 入口渲染（不挂 Router/App）。
 * 内容只读既有事实：`useOperationProgressStore`（后台操作进度， SSE 驱动、`_init` 幂等），
 * 不新建状态源（CS01）；组件本身不做任何后台轮询。
 */

import { useTranslation } from "react-i18next";
import { OperationStatusBar } from "../common/OperationStatusBar";
import { useOperationProgressStore } from "../../stores/operationProgressStore";
import { closeFloatingWindow, focusMainWindow } from "../../lib/floatingWindow";

export function FloatingPanel() {
  const { t } = useTranslation();
  const operationCount = useOperationProgressStore((s) => s.operations.length);

  return (
    <div className="h-screen w-screen flex flex-col bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 select-none">
      {/* 无边框窗口的拖拽区（Tauri `data-tauri-drag-region`）+ 关闭 */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
      >
        <span
          data-tauri-drag-region
          className="text-xs font-medium text-gray-700 dark:text-gray-200"
        >
          {t("floating.title")}
        </span>
        <button
          onClick={() => {
            void closeFloatingWindow();
          }}
          aria-label={t("floating.close")}
          title={t("floating.close")}
          className="w-6 h-6 rounded flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {operationCount === 0 ? (
          <div className="px-3 py-3 text-xs text-gray-400 dark:text-gray-500">
            {t("floating.empty")}
          </div>
        ) : (
          // 复用全局状态条（其 `_init` 已幂等注册 SSE；此处只做展示）
          <OperationStatusBar />
        )}
      </div>

      <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 flex justify-end">
        <button
          onClick={() => {
            void focusMainWindow();
          }}
          className="px-2 py-1 text-[11px] rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          {t("floating.backToMain")}
        </button>
      </div>
    </div>
  );
}

export default FloatingPanel;
