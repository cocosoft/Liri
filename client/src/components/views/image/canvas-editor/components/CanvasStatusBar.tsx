// canvas-editor/components/CanvasStatusBar.tsx — 状态栏

import React from "react";
import { CanvasState } from "../types";

interface Props {
  state: CanvasState;
  cursorPos: { x: number; y: number };
  /** 点击缩放百分比时重置到 100% */
  onZoomReset?: () => void;
}

const TOOL_LABELS: Record<string, string> = {
  pencil: "画笔", eraser: "橡皮", line: "直线", arrow: "箭头",
  rect: "矩形", roundedRect: "圆角矩形", ellipse: "椭圆",
  polygon: "多边形", star: "星形", fill: "填充", text: "文字",
  eyedropper: "取色", select: "选区", lasso: "套索", pan: "平移",
};

export const CanvasStatusBar: React.FC<Props> = ({ state, cursorPos, onZoomReset }) => (
  <div className="flex items-center justify-between px-3 py-1 text-[10px] text-gray-500 border-t border-gray-700/20 bg-gray-900/50">
    <span>{state.width} × {state.height}</span>
    <span className="flex items-center gap-3">
      <span>{TOOL_LABELS[state.activeTool] || state.activeTool}</span>
      <span>🖌 {state.strokeWidth}px</span>
      <span>({Math.round(cursorPos.x)}, {Math.round(cursorPos.y)})</span>
    </span>
    <button
      onClick={onZoomReset}
      className="text-[10px] text-gray-500 hover:text-gray-300 bg-transparent border-0 cursor-pointer transition-colors"
      title="点击重置为 100%"
    >
      {Math.round(state.zoom * 100)}%
    </button>
  </div>
);
