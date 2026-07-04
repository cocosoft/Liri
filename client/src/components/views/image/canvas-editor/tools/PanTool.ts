// canvas-editor/tools/PanTool.ts — 拖拽平移画布

import { CanvasTool, CanvasPointerEvent } from "../types";
import { CanvasToolHandler, ToolContext } from "./base";

export class PanTool implements CanvasToolHandler {
  readonly id: CanvasTool = "pan";
  readonly cursor = "grab";

  private isDown = false;
  private startOx = 0;
  private startOy = 0;
  private startLx = 0;
  private startLy = 0;

  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext) {
    this.isDown = true;
    // 记录起始的 offset（像素空间）和指针位置（逻辑坐标）
    this.startOx = ctx.transform.offsetX;
    this.startOy = ctx.transform.offsetY;
    this.startLx = e.x;
    this.startLy = e.y;
  }

  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext) {
    if (!this.isDown) return;
    // 计算逻辑坐标增量 → 转换为像素偏移
    const scale = ctx.transform.zoom * ctx.transform.dpr;
    const dx = (e.x - this.startLx) * scale;
    const dy = (e.y - this.startLy) * scale;
    ctx.transform.setOffset(this.startOx + dx, this.startOy + dy);
    window.dispatchEvent(new Event("canvas-render"));
  }

  onPointerUp(_e: CanvasPointerEvent, _ctx: ToolContext) {
    this.isDown = false;
  }

  onDeactivate() {
    this.isDown = false;
  }
}
