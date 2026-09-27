// canvas-editor/components/CanvasToolbar.tsx — 工具栏（含 paramsSchema 驱动的动态参数面板）

import React from "react";
import { useTranslation } from "react-i18next";
import { CanvasTool, CanvasState, ParamSchema } from "../types";

const TOOLS: {
  id: CanvasTool;
  label: string;
  nameKey: string;
  key: string;
}[] = [
  { id: "pencil", label: "✏️", nameKey: "media.canvasToolPencil", key: "B" },
  { id: "eraser", label: "🧹", nameKey: "media.canvasToolEraser", key: "E" },
  { id: "line", label: "─", nameKey: "media.canvasToolLine", key: "L" },
  { id: "arrow", label: "→", nameKey: "media.canvasToolArrow", key: "A" },
  { id: "rect", label: "□", nameKey: "media.canvasToolRect", key: "R" },
  {
    id: "roundedRect",
    label: "▢",
    nameKey: "media.canvasToolRoundedRect",
    key: "U",
  },
  { id: "ellipse", label: "○", nameKey: "media.canvasToolEllipse", key: "O" },
  { id: "polygon", label: "⬠", nameKey: "media.canvasToolPolygon", key: "Y" },
  { id: "star", label: "☆", nameKey: "media.canvasToolStar", key: "S" },
  { id: "fill", label: "🪣", nameKey: "media.canvasToolFill", key: "G" },
  { id: "text", label: "🔤", nameKey: "media.canvasToolText", key: "T" },
  {
    id: "eyedropper",
    label: "💉",
    nameKey: "media.canvasToolEyedropper",
    key: "I",
  },
  { id: "pan", label: "✋", nameKey: "media.canvasToolPan", key: "H" },
  { id: "select", label: "⬜", nameKey: "media.canvasToolSelect", key: "V" },
  { id: "lasso", label: "🔗", nameKey: "media.canvasToolLasso", key: "M" },
];

const COLORS = [
  "#000000",
  "#ffffff",
  "#ff0000",
  "#00ff00",
  "#0000ff",
  "#ffff00",
  "#ff00ff",
  "#00ffff",
];

interface Props {
  state: CanvasState;
  canUndo: boolean;
  canRedo: boolean;
  /** 当前工具的 paramsSchema */
  paramsSchema?: ParamSchema[];
  onToolChange: (tool: CanvasTool) => void;
  onToolParamChange: (name: string, value: unknown) => void;
  onFgColor: (color: string) => void;
  onBgColor?: (color: string) => void;
  onStrokeWidth: (w: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onExport: (format: "png" | "jpeg" | "webp") => void;
  onResizeClick?: () => void;
  /** Modal 模式：是否显示导出按钮（默认 true；onSave 传入时隐藏） */
  showExport?: boolean;
  /** Modal 模式：保存回调 */
  onSave?: () => void;
  /** Modal 模式：取消回调 */
  onCancel?: () => void;
}

/** 渲染单个参数控件 */
function ParamControl({
  schema,
  value,
  onChange,
}: {
  schema: ParamSchema;
  value: unknown;
  onChange: (name: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  if (schema.type === "boolean") {
    return (
      <label className="flex items-center gap-1 text-xs text-gray-400">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(schema.name, e.target.checked)}
          className="accent-blue-500"
        />
        {t(schema.labelKey)}
      </label>
    );
  }

  if (schema.type === "number") {
    const numVal =
      typeof value === "number" ? value : (schema.default as number) || 0;
    return (
      <label className="flex items-center gap-1 text-xs text-gray-400">
        <span>{t(schema.labelKey)}</span>
        <input
          type="number"
          value={numVal}
          step={schema.name === "innerRatio" ? 0.1 : 1}
          min={
            schema.name === "innerRatio"
              ? 0.1
              : schema.name === "sides" || schema.name === "points"
                ? 3
                : 1
          }
          max={
            schema.name === "innerRatio"
              ? 0.9
              : schema.name === "sides"
                ? 12
                : schema.name === "points"
                  ? 12
                  : 100
          }
          onChange={(e) =>
            onChange(
              schema.name,
              schema.name === "innerRatio"
                ? parseFloat(e.target.value)
                : parseInt(e.target.value),
            )
          }
          className="w-12 h-5 px-1 text-xs bg-gray-800 border border-gray-600/40 rounded text-gray-300 outline-none focus:border-blue-500/50"
        />
      </label>
    );
  }

  return null;
}

export const CanvasToolbar: React.FC<Props> = ({
  state,
  canUndo,
  canRedo,
  paramsSchema,
  onToolChange,
  onToolParamChange,
  onFgColor,
  onBgColor,
  onStrokeWidth,
  onUndo,
  onRedo,
  onExport,
  onResizeClick,
  showExport = true,
  onSave,
  onCancel,
}) => {
  const { t } = useTranslation();
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700/20 bg-gray-900/30"
      data-canvas-toolbar
      role="toolbar"
      aria-label={t("media.canvasToolbar")}
    >
      {/* 工具按钮 */}
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          onClick={() => onToolChange(tool.id)}
          className={`w-7 h-7 rounded flex items-center justify-center text-sm border-0 cursor-pointer transition-colors ${state.activeTool === tool.id ? "bg-blue-600/40 ring-1 ring-blue-500" : "bg-gray-800/50 hover:bg-gray-700/50"}`}
          title={`${t(tool.nameKey)} (${tool.key})`}
        >
          {tool.label}
        </button>
      ))}

      <div className="w-px h-4 bg-gray-600/30" />

      {/* 动态工具参数面板（由 paramsSchema 驱动） */}
      {paramsSchema && paramsSchema.length > 0 && (
        <>
          <div className="flex gap-2">
            {paramsSchema.map((schema) => (
              <ParamControl
                key={schema.name}
                schema={schema}
                value={state.toolParams[schema.name]}
                onChange={onToolParamChange}
              />
            ))}
          </div>
          <div className="w-px h-4 bg-gray-600/30" />
        </>
      )}

      {/* 颜色 */}
      <div className="flex gap-1">
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onFgColor(c)}
            className="w-4 h-4 rounded-full border border-gray-500/30 cursor-pointer"
            style={{ background: c }}
            title={c}
          />
        ))}
      </div>
      <div className="flex flex-col gap-0.5">
        <input
          type="color"
          value={state.fgColor}
          onChange={(e) => onFgColor(e.target.value)}
          className="w-5 h-[10px] border-0 bg-transparent cursor-pointer p-0"
          title={t("media.canvasForeground")}
        />
        <input
          type="color"
          value={state.bgColor}
          onChange={(e) => onBgColor?.(e.target.value)}
          className="w-5 h-[10px] border-0 bg-transparent cursor-pointer p-0"
          title={t("media.canvasBackground")}
        />
      </div>

      <div className="w-px h-4 bg-gray-600/30" />

      {/* 笔刷大小 */}
      <input
        type="range"
        min={1}
        max={20}
        value={state.strokeWidth}
        onChange={(e) => onStrokeWidth(Number(e.target.value))}
        className="w-16 h-1 accent-blue-500"
        title={t("media.canvasBrushSize")}
      />

      <div className="w-px h-4 bg-gray-600/30" />

      {/* 撤销/重做 */}
      <button
        onClick={onUndo}
        disabled={!canUndo}
        className="text-xs px-1.5 py-0.5 rounded bg-gray-800/50 border-0 cursor-pointer disabled:opacity-30 text-gray-400 hover:bg-gray-700/50"
      >
        ⟲
      </button>
      <button
        onClick={onRedo}
        disabled={!canRedo}
        className="text-xs px-1.5 py-0.5 rounded bg-gray-800/50 border-0 cursor-pointer disabled:opacity-30 text-gray-400 hover:bg-gray-700/50"
      >
        ⟳
      </button>

      <div className="w-px h-4 bg-gray-600/30" />

      {/* 导出按钮（Modal 模式隐藏） */}
      {showExport && (
        <div className="flex gap-1">
          <button
            onClick={() => onExport("png")}
            className="text-xs px-1.5 py-0.5 rounded bg-gray-800/50 border-0 cursor-pointer text-gray-400 hover:bg-gray-700/50"
            title={t("media.canvasExportPng")}
          >
            PNG
          </button>
          <button
            onClick={() => onExport("jpeg")}
            className="text-xs px-1.5 py-0.5 rounded bg-gray-800/50 border-0 cursor-pointer text-gray-400 hover:bg-gray-700/50"
            title={t("media.canvasExportJpeg")}
          >
            JPG
          </button>
          <button
            onClick={() => onExport("webp")}
            className="text-xs px-1.5 py-0.5 rounded bg-gray-800/50 border-0 cursor-pointer text-gray-400 hover:bg-gray-700/50"
            title={t("media.canvasExportWebp")}
          >
            WEBP
          </button>
        </div>
      )}

      {onResizeClick && (
        <>
          <div className="w-px h-4 bg-gray-600/30" />
          <button
            onClick={onResizeClick}
            className="text-xs px-1.5 py-0.5 rounded bg-gray-800/50 border-0 cursor-pointer text-gray-400 hover:bg-gray-700/50"
            title={t("media.canvasResize")}
          >
            ↔
          </button>
        </>
      )}

      {/* Modal 模式：保存/取消按钮 */}
      {(onSave || onCancel) && (
        <div className="ml-auto flex gap-2">
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-3 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 border-0 cursor-pointer text-gray-300"
            >
              {t("common.cancel")}
            </button>
          )}
          {onSave && (
            <button
              onClick={onSave}
              className="px-3 py-1 text-xs rounded bg-blue-700/40 hover:bg-blue-600/40 border-0 cursor-pointer text-blue-200"
            >
              {t("common.save")}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
