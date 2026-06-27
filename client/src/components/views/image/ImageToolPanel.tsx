/**
 * ImageToolPanel
 * 左侧工具入口面板 — 选择工具类型 → 展开 ToolParamForm
 * 引用 toolRegistry 集中管理工具定义
 */
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import ToolParamForm from "./ToolParamForm";
import { TOOL_ENTRIES } from "./toolRegistry";

interface Props {
  onExecute: (toolName: string, args: Record<string, unknown>) => void;
  loading?: boolean;
}

export default function ImageToolPanel({ onExecute, loading }: Props) {
  const { t } = useTranslation();
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const handleSelect = useCallback((toolName: string) => {
    setActiveTool((prev) => (prev === toolName ? null : toolName));
  }, []);

  const handleSubmit = useCallback(
    (args: Record<string, unknown>) => {
      if (activeTool) {
        onExecute(activeTool, args);
      }
    },
    [activeTool, onExecute]
  );

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium text-gray-300 uppercase tracking-wider">
        {t("image.imageTools")}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TOOL_ENTRIES.map((tool) => (
          <button
            key={tool.name}
            onClick={() => handleSelect(tool.name)}
            disabled={loading}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs border cursor-pointer transition-colors disabled:opacity-40 ${
              activeTool === tool.name
                ? "bg-blue-600/30 text-blue-300 border-blue-500/40"
                : "bg-gray-700/60 text-gray-200 border-gray-600/30 hover:bg-gray-600/50 hover:text-white"
            }`}
          >
            <span className="text-sm">{tool.icon}</span>
            <span>{t(tool.labelKey)}</span>
          </button>
        ))}
      </div>

      {activeTool && (
        <div className="bg-gray-800/40 rounded p-3 border border-gray-700/30">
          <ToolParamForm
            toolName={activeTool}
            onSubmit={handleSubmit}
            loading={loading}
          />
        </div>
      )}
    </div>
  );
}
