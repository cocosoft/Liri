// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * CollapsedBar — 面板**收起态**的竖向标签条（点击展开并切到该 Tab）。
 *
 * FSZ-161（2026-09-23）：自 `ChatInspector.tsx` **逐字迁移**（宿主 898 行 > `lint:size`
 * 800 阈值），仅把原来引用的模块级常量 `TABS` 改为**入参 `tabs`** —— 这样新文件
 * 无需反向依赖宿主（避免"子组件 ↔ 宿主"的运行时循环导入），且标签表仍是宿主的单一来源。
 *
 * 角标语义（与原实现一致）：轨迹 Tab 显示活跃工具数、文件 Tab 显示新增文件数、
 * 上下文 Tab 在 token 告警时显示 `!`。
 */
import React from "react";
import { useChatInspectorStore } from "../../stores/chatInspectorStore";
import type { InspectorTab } from "../../stores/chatInspectorStore";

/** 标签项形状（与宿主 `TABS` 的元素类型结构一致） */
export interface CollapsedBarTab {
  id: InspectorTab;
  icon: React.ReactNode;
  label: string;
}

function CollapsedBarImpl({
  tabs,
  onExpandAndSwitch,
}: {
  tabs: readonly CollapsedBarTab[];
  onExpandAndSwitch: (tab: InspectorTab) => void;
}) {
  const activeToolCount = useChatInspectorStore((s) => s.activeToolCount);
  const newFileCount = useChatInspectorStore((s) => s.newFileCount);
  const tokenWarning = useChatInspectorStore((s) => s.tokenWarning);

  return (
    <div className="w-12 flex flex-col items-center py-2 gap-2 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700">
      {tabs.map((tab) => {
        const badge =
          tab.id === "trajectory" && activeToolCount > 0
            ? `${activeToolCount}`
            : tab.id === "files" && newFileCount > 0
              ? `+${newFileCount}`
              : tab.id === "context" && tokenWarning
                ? "!"
                : null;
        return (
          <button
            key={tab.id}
            onClick={() => onExpandAndSwitch(tab.id)}
            className="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            title={`展开到${tab.label} Tab`}
          >
            {tab.icon}
            {badge && (
              <span
                className={`absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white rounded-full ${
                  tab.id === "context"
                    ? "bg-red-500"
                    : tab.id === "trajectory"
                      ? "bg-blue-500 animate-pulse"
                      : "bg-green-500"
                }`}
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default React.memo(CollapsedBarImpl);
