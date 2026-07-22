// canvas-editor/tools/EraserTool.ts — 橡皮擦（Path2D 延迟绘制 + bgColor/透明双模式）

import { CanvasTool, CanvasPointerEvent, ParamSchema } from "../types";
import { CanvasToolHandler, ToolContext } from "./base";

export class EraserTool implements CanvasToolHandler {
  readonly id: CanvasTool = "eraser";
  readonly cursor = "cell";
  readonly paramsSchema: ParamSchema[] = [
    {
      name: "transparent",
      type: "boolean",
      default: false,
      labelKey: "透明擦",
    },
  ];

  private isErasing = false;
  private path: Path2D | null = null;
  private bbox = { x: Infinity, y: Infinity, w: 0, h: 0 };

  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext) {
    this.isErasing = true;
    this.path = new Path2D();
    this.path.moveTo(e.x, e.y);

    const r = ctx.state.strokeWidth * 2;
    this.bbox = { x: e.x - r, y: e.y - r, w: r * 2, h: r * 2 };
  }

  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext) {
    if (!this.isErasing || !this.path) return;

    this.path.lineTo(e.x, e.y);

    const r = ctx.state.strokeWidth * 2;
    this.bbox = {
      x: Math.min(this.bbox.x, e.x - r),
      y: Math.min(this.bbox.y, e.y - r),
      w:
        Math.max(this.bbox.x + this.bbox.w, e.x + r) -
        Math.min(this.bbox.x, e.x - r),
      h:
        Math.max(this.bbox.y + this.bbox.h, e.y + r) -
        Math.min(this.bbox.y, e.y - r),
    };

    // Interactive 层预览
    const ic = ctx.interactiveCtx;
    if (ic) {
      ic.setTransform(1, 0, 0, 1, 0, 0);
      ic.clearRect(0, 0, ic.canvas.width, ic.canvas.height);
      ctx.transform.applyTransform(ic);
      if (ctx.state.toolParams.transparent) {
        ic.globalCompositeOperation = "destination-out";
        ic.strokeStyle = "#000";
      } else {
        ic.strokeStyle = ctx.state.bgColor;
      }
      ic.lineWidth = ctx.state.strokeWidth * 2;
      ic.lineCap = "round";
      ic.lineJoin = "round";
      ic.stroke(this.path);
      ic.globalCompositeOperation = "source-over";
    }
  }

  onPointerUp(_e: CanvasPointerEvent, ctx: ToolContext) {
    if (!this.isErasing || !this.path) return;
    this.isErasing = false;

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

    const before = ctx.buffer.getImageData(x, y, w, h);

    const c = ctx.buffer.ctx;
    if (ctx.state.toolParams.transparent) {
      c.globalCompositeOperation = "destination-out";
      c.strokeStyle = "#000";
    } else {
      c.strokeStyle = ctx.state.bgColor;
    }
    c.lineWidth = ctx.state.strokeWidth * 2;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.stroke(this.path);
    c.globalCompositeOperation = "source-over";

    const after = ctx.buffer.getImageData(x, y, w, h);

    ctx.commands.execute({
      type: "stroke",
      bbox: { x, y, w, h },
      before,
      after,
      apply: (ctx2) => {
        ctx2.putImageData(after, x, y);
      },
      revert: (ctx2) => {
        ctx2.putImageData(before, x, y);
      },
    });

    this.path = null;
    window.dispatchEvent(new Event("canvas-render"));
  }
}
