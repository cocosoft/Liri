// canvas-editor/components/CanvasStatusBar.tsx — 状态栏

import React from "react";
import { useTranslation } from "react-i18next";
import { CanvasState } from "../types";

interface Props {
  state: CanvasState;
  cursorPos: { x: number; y: number };
  /** 点击缩放百分比时重置到 100% */
  onZoomReset?: () => void;
}

const TOOL_LABEL_KEYS: Record<string, string> = {
  pencil: "media.canvasToolPencil",
  eraser: "media.canvasToolEraser",
  line: "media.canvasToolLine",
  arrow: "media.canvasToolArrow",
  rect: "media.canvasToolRect",
  roundedRect: "media.canvasToolRoundedRect",
  ellipse: "media.canvasToolEllipse",
  polygon: "media.canvasToolPolygon",
  star: "media.canvasToolStar",
  fill: "media.canvasToolFill",
  text: "media.canvasToolText",
  eyedropper: "media.canvasToolEyedropper",
  select: "media.canvasToolSelect",
  lasso: "media.canvasToolLasso",
  pan: "media.canvasToolPan",
};

export const CanvasStatusBar: React.FC<Props> = ({
  state,
  cursorPos,
  onZoomReset,
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between px-3 py-1 text-[10px] text-gray-500 border-t border-gray-700/20 bg-gray-900/50">
      <span>
        {state.width} × {state.height}
      </span>
      <span className="flex items-center gap-3">
        <span>
          {TOOL_LABEL_KEYS[state.activeTool]
            ? t(TOOL_LABEL_KEYS[state.activeTool])
            : state.activeTool}
        </span>
        <span>🖌 {state.strokeWidth}px</span>
        <span>
          ({Math.round(cursorPos.x)}, {Math.round(cursorPos.y)})
        </span>
      </span>
      <button
        onClick={onZoomReset}
        className="text-[10px] text-gray-500 hover:text-gray-300 bg-transparent border-0 cursor-pointer transition-colors"
        title={t("media.canvasResetZoom")}
      >
        {Math.round(state.zoom * 100)}%
      </button>
    </div>
  );
};
