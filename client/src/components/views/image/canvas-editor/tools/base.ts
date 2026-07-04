// canvas-editor/tools/base.ts — 工具接口 + ToolContext

import { CanvasTool, CanvasPointerEvent, ParamSchema, CanvasState } from "../types";
import { CanvasTransform } from "../core/CanvasTransform";
import { CommandManager } from "../core/CommandManager";
import { OffscreenBuffer } from "../core/OffscreenBuffer";

export interface ToolContext {
  buffer: OffscreenBuffer;
  transform: CanvasTransform;
  state: CanvasState;
  commands: CommandManager;
  setActiveTool: (tool: CanvasTool) => void;
  /** Interactive 层 ctx — 用于 mousemove 形状预览（应用了 transform） */
  interactiveCtx: CanvasRenderingContext2D | null;
  /** Overlay 层 ctx — 用于选区框/文字编辑框（像素对齐，无 transform） */
  overlayCtx: CanvasRenderingContext2D | null;
  /** Overlay 层 Canvas 元素 — 用于 textarea 定位计算 */
  overlayCanvas: HTMLCanvasElement | null;
}

export interface CanvasToolHandler {
  readonly id: CanvasTool;
  readonly cursor: string;
  readonly paramsSchema?: ParamSchema[];
  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void;
  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void;
  onPointerUp(e: CanvasPointerEvent, ctx: ToolContext): void;
  onActivate?(ctx: ToolContext): void;
  onDeactivate?(): void;
}
