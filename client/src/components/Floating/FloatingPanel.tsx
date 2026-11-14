// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * FloatingPanel —— 全局悬浮窗内容（G8 一期，2026-11-14）
 *
 * 由 `main.tsx` 在 `?floating=1` 入口渲染（不挂 Router/App）。
 * 内容只读既有事实：`useOperationProgressStore`（后台操作进度， SSE 驱动、`_init` 幂等），
 * 不新建状态源（CS01）；组件本身不做任何后台轮询。
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { OperationStatusBar } from "../common/OperationStatusBar";
import { useOperationProgressStore } from "../../stores/operationProgressStore";
import {
  closeFloatingWindow,
  focusMainWindow,
  initFloatingWindowGeometry,
} from "../../lib/floatingWindow";
import { useFloatingContext } from "./useFloatingContext";

export function FloatingPanel() {
  const { t } = useTranslation();
  const operationCount = useOperationProgressStore((s) => s.operations.length);
  // G8 内容增强（2026-11-14）：当前会话 + 运行中目标（挂载/聚焦时刷新，不轮询）
  const { context, loading, refresh } = useFloatingContext();

  // G8 窗口体验（2026-11-14）：几何记忆 + 多显示器边界校正（非悬浮窗/非 Tauri ⇒ no-op）
  useEffect(() => {
    void initFloatingWindowGeometry();
  }, []);

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

      {/* G8 内容增强（2026-11-14）：当前会话 + 运行中目标（读取失败如实标注，不假装为空） */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
            {t("floating.currentSession")}
          </span>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            {t("floating.refresh")}
          </button>
        </div>
        <div
          className="text-xs truncate"
          title={context?.session?.title ?? undefined}
        >
          {context?.session
            ? (context.session.title ?? t("floating.untitledSession"))
            : t("floating.noSession")}
        </div>

        <div className="pt-1 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
          {t("floating.goals")}
        </div>
        {context && context.goals.length > 0 ? (
          <ul className="space-y-0.5">
            {context.goals.map((goal) => (
              <li
                key={goal.id}
                className="text-xs flex items-start justify-between gap-2"
              >
                <span className="truncate" title={goal.objective}>
                  {goal.objective}
                </span>
                <span className="shrink-0 text-[10px] text-gray-400">
                  {goal.tokenBudget === null
                    ? goal.tokensUsed
                    : `${goal.tokensUsed}/${goal.tokenBudget}`}{" "}
                  {t("floating.tokensUnit")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-xs text-gray-400 dark:text-gray-500">
            {context?.unavailable
              ? t("floating.unavailable")
              : t("floating.noGoals")}
          </div>
        )}
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
