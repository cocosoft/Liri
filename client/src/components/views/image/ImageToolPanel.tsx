/**
 * ImageToolPanel
 * 左侧工具入口面板 — 选择工具类型 → 展开 ToolParamForm
 */
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import ToolParamForm from "./ToolParamForm";

interface Props {
  onExecute: (toolName: string, args: Record<string, unknown>) => void;
  loading?: boolean;
}

/** 工具名 → i18n 键 + emoji 映射 */
const TOOL_KEYS: Record<string, { labelKey: string; icon: string }> = {
  image_generate:     { labelKey: "image.generate", icon: "🖼" },
  image_analysis:     { labelKey: "image.analyze",  icon: "🔍" },
  image:              { labelKey: "image.edit",      icon: "✂" },
  image_svg_generate: { labelKey: "image.svg",       icon: "📐" },
  canvas:             { labelKey: "image.canvas",    icon: "🎨" },
};

export default function ImageToolPanel({ onExecute, loading }: Props) {
  const { t } = useTranslation();
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const handleSelect = useCallback((toolName: string) => {
    setActiveTool((prev) => (prev === toolName ? null : toolName));
  }, []);

  const handleSubmit = useCallback(
    (args: Record<string, unknown>) => {
      if (activeTool) onExecute(activeTool, args);
    },
    [activeTool, onExecute]
  );

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium text-gray-300 uppercase tracking-wider">
        {t("image.imageTools")}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {Object.entries(TOOL_KEYS).map(([toolName, { labelKey, icon }]) => (
          <button
            key={toolName}
            onClick={() => handleSelect(toolName)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs border-0 cursor-pointer transition-colors ${
              activeTool === toolName
                ? "bg-blue-600/30 text-blue-300 border border-blue-500/30"
                : "bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 border border-gray-700/30"
            }`}
          >
            <span className="text-sm">{icon}</span>
            <span>{t(labelKey)}</span>
          </button>
        ))}
      </div>

      {activeTool && (
        <div className="bg-gray-800/40 rounded p-3 border border-gray-700/30">
          <ToolParamForm toolName={activeTool} onSubmit={handleSubmit} loading={loading} />
        </div>
      )}
    </div>
  );
}
