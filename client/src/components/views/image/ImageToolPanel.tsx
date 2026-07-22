/**
 * ImageToolPanel
 * 左侧工具入口面板 — 选择工具类型 → 展开 ToolParamForm
 * 引用 toolRegistry 集中管理工具定义
 * activeTool 状态由父组件 ImagePage 管理（用于图库联动）
 */
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import ToolParamForm from "./ToolParamForm";
import { TOOL_ENTRIES } from "./toolRegistry";

interface Props {
  activeTool: string | null;
  onActiveToolChange: (toolName: string | null) => void;
  onExecute: (toolName: string, args: Record<string, unknown>) => void;
  loading?: boolean;
  /** 从图库选中的图片路径（由 ImagePage 注入） */
  selectedPath?: string | null;
}

export default function ImageToolPanel({
  activeTool,
  onActiveToolChange,
  onExecute,
  loading,
  selectedPath,
}: Props) {
  const { t } = useTranslation();

  const handleSelect = useCallback(
    (toolName: string) => {
      onActiveToolChange(activeTool === toolName ? null : toolName);
    },
    [activeTool, onActiveToolChange],
  );

  const handleSubmit = useCallback(
    (args: Record<string, unknown>) => {
      if (activeTool) {
        onExecute(activeTool, args);
      }
    },
    [activeTool, onExecute],
  );

  const categoryLabels: Record<string, string> = {
    generate: t("image.categoryGenerate"),
    analyze: t("image.categoryAnalyze"),
    edit: t("image.categoryEdit"),
    other: t("image.categoryOther"),
  };

  // 按分类分组工具
  const groupedTools = useMemo(
    () =>
      TOOL_ENTRIES.reduce(
        (acc, tool) => {
          const cat = tool.category || "other";
          if (!acc[cat]) acc[cat] = [];
          acc[cat].push(tool);
          return acc;
        },
        {} as Record<string, typeof TOOL_ENTRIES>,
      ),
    [],
  );

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium text-gray-300 uppercase tracking-wider">
        {t("image.imageTools")}
      </div>

      {Object.entries(groupedTools).map(([category, tools]) => (
        <div key={category}>
          <div className="text-[10px] text-gray-500 mb-1 ml-0.5">
            {categoryLabels[category] || category}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tools.map((tool) => (
              <button
                key={tool.name}
                onClick={() => !tool.disabled && handleSelect(tool.name)}
                disabled={loading || tool.disabled}
                title={tool.disabled ? tool.disabledReason : undefined}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs border cursor-pointer transition-colors ${
                  tool.disabled
                    ? "bg-gray-800/30 text-gray-600 border-gray-700/20 cursor-not-allowed opacity-50"
                    : activeTool === tool.name
                      ? "bg-blue-600/30 text-blue-300 border-blue-500/40"
                      : "bg-gray-700/60 text-gray-200 border-gray-600/30 hover:bg-gray-600/50 hover:text-white"
                }`}
              >
                <span className="text-sm">{tool.icon}</span>
                <span>{t(tool.labelKey)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {activeTool && (
        <div className="bg-gray-800/40 rounded p-3 border border-gray-700/30">
          <ToolParamForm
            key={activeTool}
            toolName={activeTool}
            onSubmit={handleSubmit}
            loading={loading}
            selectedPath={selectedPath}
            onCancel={() => onActiveToolChange(null)}
          />
        </div>
      )}
    </div>
  );
}
