// canvas-editor/tools/PencilTool.ts — 画笔（Path2D 延迟绘制，保留 undo 前像素）

import { CanvasTool, CanvasPointerEvent } from "../types";
import { CanvasToolHandler, ToolContext } from "./base";

export class PencilTool implements CanvasToolHandler {
  readonly id: CanvasTool = "pencil";
  readonly cursor = "crosshair";

  private isDrawing = false;
  private path: Path2D | null = null;
  private bbox = { x: Infinity, y: Infinity, w: 0, h: 0 };

  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext) {
    this.isDrawing = true;
    this.path = new Path2D();
    this.path.moveTo(e.x, e.y);

    const r = ctx.state.strokeWidth;
    this.bbox = { x: e.x - r, y: e.y - r, w: r * 2, h: r * 2 };
  }

  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext) {
    if (!this.isDrawing || !this.path) return;

    this.path.lineTo(e.x, e.y);

    // 增量扩展 bbox
    const r = ctx.state.strokeWidth;
    this.bbox = {
      x: Math.min(this.bbox.x, e.x - r),
      y: Math.min(this.bbox.y, e.y - r),
      w: Math.max(this.bbox.x + this.bbox.w, e.x + r) - Math.min(this.bbox.x, e.x - r),
      h: Math.max(this.bbox.y + this.bbox.h, e.y + r) - Math.min(this.bbox.y, e.y - r),
    };

    // 在 Interactive 层绘制预览
    const ic = ctx.interactiveCtx;
    if (ic) {
      ic.setTransform(1, 0, 0, 1, 0, 0);
      ic.clearRect(0, 0, ic.canvas.width, ic.canvas.height);
      ctx.transform.applyTransform(ic);
      ic.strokeStyle = ctx.state.fgColor;
      ic.lineWidth = ctx.state.strokeWidth;
      ic.lineCap = "round";
      ic.lineJoin = "round";
      ic.stroke(this.path);
    }
  }

  onPointerUp(_e: CanvasPointerEvent, ctx: ToolContext) {
    if (!this.isDrawing || !this.path) return;
    this.isDrawing = false;

    // 清除 Interactive 层预览
    const ic = ctx.interactiveCtx;
    if (ic) {
      ic.setTransform(1, 0, 0, 1, 0, 0);
      ic.clearRect(0, 0, ic.canvas.width, ic.canvas.height);
    }

    const b = this.bbox;
    const w = Math.max(Math.ceil(b.w), 1);
    const h = Math.max(Math.ceil(b.h), 1);
    const x = Math.max(0, Math.floor(b.x));
    const y = Math.max(0, Math.floor(b.y));

    // 保存绘制前的像素
    const before = ctx.buffer.getImageData(x, y, w, h);

    // 一次性绘制完整路径到 buffer
    const c = ctx.buffer.ctx;
    c.strokeStyle = ctx.state.fgColor;
    c.lineWidth = ctx.state.strokeWidth;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.stroke(this.path);

    const after = ctx.buffer.getImageData(x, y, w, h);

    ctx.commands.execute({
      type: "stroke",
      bbox: { x, y, w, h },
      before, after,
      apply: (ctx2) => { ctx2.putImageData(after, x, y); },
      revert: (ctx2) => { ctx2.putImageData(before, x, y); },
    });

    this.path = null;

    window.dispatchEvent(new Event("canvas-render"));
  }
}
