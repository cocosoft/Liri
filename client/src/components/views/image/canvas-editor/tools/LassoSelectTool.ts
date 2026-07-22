// canvas-editor/tools/LassoSelectTool.ts — 套索选区工具
// 自由路径选区：mousedown → 记录路径 → mouseup 闭合 → 转为多边形选区
// 选区显示在 Overlay 层（像素对齐）

import { CanvasTool, CanvasPointerEvent } from "../types";
import { CanvasToolHandler, ToolContext } from "./base";

interface LassoState {
  mode: "idle" | "drawing" | "selected" | "moving";
  path: { x: number; y: number }[];
  bbox: { x: number; y: number; w: number; h: number };
  moveStartX: number;
  moveStartY: number;
  selectedPixels: ImageData | null;
  dashOffset: number;
  marqueeTimer: number;
}

export class LassoSelectTool implements CanvasToolHandler {
  readonly id: CanvasTool = "lasso";
  readonly cursor = "crosshair";

  private s: LassoState = {
    mode: "idle",
    path: [],
    bbox: { x: 0, y: 0, w: 0, h: 0 },
    moveStartX: 0,
    moveStartY: 0,
    selectedPixels: null,
    dashOffset: 0,
    marqueeTimer: 0,
  };

  /** 获取选区信息 */
  getSelection(): { x: number; y: number; w: number; h: number } | null {
    if (this.s.mode !== "selected" || this.s.bbox.w < 2 || this.s.bbox.h < 2)
      return null;
    return { ...this.s.bbox };
  }

  onActivate() {
    this.s.mode = "idle";
    this.startMarquee();
  }

  onDeactivate() {
    this.stopMarquee();
    this.s.mode = "idle";
    this.s.path = [];
    this.s.bbox = { x: 0, y: 0, w: 0, h: 0 };
  }

  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext) {
    const rx = Math.round(e.x),
      ry = Math.round(e.y);

    if (this.s.mode === "selected") {
      // 检查是否在选区内 → 移动模式
      const b = this.s.bbox;
      if (rx >= b.x && rx <= b.x + b.w && ry >= b.y && ry <= b.y + b.h) {
        this.s.mode = "moving";
        this.s.moveStartX = rx;
        this.s.moveStartY = ry;
        this.s.selectedPixels = ctx.buffer.getImageData(b.x, b.y, b.w, b.h);
        return;
      }
      // 点击选区外 → 取消
      this.deselect(ctx);
      return;
    }

    // idle → drawing
    this.s.mode = "drawing";
    this.s.path = [{ x: rx, y: ry }];
    this.drawPath(ctx);
  }

  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext) {
    const rx = Math.round(e.x),
      ry = Math.round(e.y);

    if (this.s.mode === "drawing") {
      // 记录路径点（采样：与上一个点距离 > 3px 才记录）
      const last = this.s.path[this.s.path.length - 1];
      if (!last || Math.abs(rx - last.x) > 3 || Math.abs(ry - last.y) > 3) {
        this.s.path.push({ x: rx, y: ry });
      }
      this.drawPath(ctx);
      return;
    }

    if (this.s.mode === "moving" && this.s.selectedPixels) {
      const dx = rx - this.s.moveStartX,
        dy = ry - this.s.moveStartY;
      this.s.bbox.x += dx;
      this.s.bbox.y += dy;
      this.s.moveStartX = rx;
      this.s.moveStartY = ry;
      this.drawBbox(ctx);
      return;
    }
  }

  onPointerUp(_e: CanvasPointerEvent, ctx: ToolContext) {
    if (this.s.mode === "drawing") {
      if (this.s.path.length < 4) {
        // 路径太短 → 取消
        this.deselect(ctx);
        return;
      }
      // 闭合路径 → 计算 bbox
      const xs = this.s.path.map((p) => p.x);
      const ys = this.s.path.map((p) => p.y);
      const bx = Math.min(...xs),
        by = Math.min(...ys);
      const bw = Math.max(...xs) - bx,
        bh = Math.max(...ys) - by;
      this.s.bbox = { x: bx, y: by, w: bw, h: bh };
      this.s.mode = "selected";
      this.drawBbox(ctx);
      return;
    }

    if (this.s.mode === "moving" && this.s.selectedPixels) {
      // 提交移动
      const b = this.s.bbox;
      const before = ctx.buffer.getImageData(
        0,
        0,
        ctx.buffer.width,
        ctx.buffer.height,
      );

      ctx.buffer.ctx.fillStyle = ctx.state.bgColor;
      ctx.buffer.ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.buffer.ctx.putImageData(this.s.selectedPixels, b.x, b.y);

      const after = ctx.buffer.getImageData(
        0,
        0,
        ctx.buffer.width,
        ctx.buffer.height,
      );

      ctx.commands.execute({
        type: "selection",
        bbox: { x: 0, y: 0, w: ctx.buffer.width, h: ctx.buffer.height },
        before,
        after,
        apply: (c) => {
          c.putImageData(after, 0, 0);
        },
        revert: (c) => {
          c.putImageData(before, 0, 0);
        },
      });

      this.s.selectedPixels = null;
      this.s.mode = "selected";
      this.drawBbox(ctx);
      window.dispatchEvent(new Event("canvas-render"));
      return;
    }
  }

  /** 绘制套索路径（Overlay 层） */
  private drawPath(ctx: ToolContext) {
    const oc = ctx.overlayCtx;
    if (!oc || this.s.path.length < 2) return;

    const scale = ctx.transform.zoom * ctx.transform.dpr;
    const ox = ctx.transform.offsetX,
      oy = ctx.transform.offsetY;

    oc.clearRect(0, 0, oc.canvas.width, oc.canvas.height);
    oc.strokeStyle = "#fff";
    oc.lineWidth = 1.5;
    oc.setLineDash([4, 2]);
    oc.beginPath();
    for (let i = 0; i < this.s.path.length; i++) {
      const px = this.s.path[i].x * scale + ox;
      const py = this.s.path[i].y * scale + oy;
      if (i === 0) oc.moveTo(px, py);
      else oc.lineTo(px, py);
    }
    oc.stroke();
    oc.setLineDash([]);
  }

  /** 绘制选区虚线框 */
  private drawBbox(ctx: ToolContext) {
    const oc = ctx.overlayCtx;
    if (!oc || this.s.bbox.w <= 0) return;

    const scale = ctx.transform.zoom * ctx.transform.dpr;
    const ox = ctx.transform.offsetX,
      oy = ctx.transform.offsetY;
    const b = this.s.bbox;

    oc.clearRect(0, 0, oc.canvas.width, oc.canvas.height);
    oc.strokeStyle = "#fff";
    oc.lineWidth = 1;
    oc.setLineDash([5, 3]);
    oc.lineDashOffset = this.s.dashOffset;
    oc.strokeRect(b.x * scale + ox, b.y * scale + oy, b.w * scale, b.h * scale);
    oc.setLineDash([]);
  }

  private deselect(ctx: ToolContext) {
    this.s.mode = "idle";
    this.s.path = [];
    this.s.bbox = { x: 0, y: 0, w: 0, h: 0 };
    this.s.selectedPixels = null;
    const oc = ctx.overlayCtx;
    if (oc) oc.clearRect(0, 0, oc.canvas.width, oc.canvas.height);
  }

  /** 走马灯定时器 */
  private startMarquee() {
    this.stopMarquee();
    this.s.dashOffset = 0;
    this.s.marqueeTimer = window.setInterval(() => {
      this.s.dashOffset = (this.s.dashOffset + 0.5) % 16;
    }, 50);
  }

  private stopMarquee() {
    if (this.s.marqueeTimer) {
      clearInterval(this.s.marqueeTimer);
      this.s.marqueeTimer = 0;
    }
  }
}
