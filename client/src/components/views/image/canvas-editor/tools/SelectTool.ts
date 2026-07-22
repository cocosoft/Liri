// canvas-editor/tools/SelectTool.ts — 矩形选区工具
// 状态机: idle → selecting → selected → (moving →) idle
// 选区显示在 Overlay 层（像素对齐，走马灯动画）

import { CanvasTool, CanvasPointerEvent } from "../types";
import { CanvasToolHandler, ToolContext } from "./base";

type SelectState = "idle" | "selecting" | "selected" | "moving";

export class SelectTool implements CanvasToolHandler {
  readonly id: CanvasTool = "select";
  readonly cursor = "crosshair";

  private mode: SelectState = "idle";
  private selX = 0;
  private selY = 0;
  private selW = 0;
  private selH = 0;
  private startX = 0;
  private startY = 0;
  private moveStartX = 0;
  private moveStartY = 0;
  private selectedPixels: ImageData | null = null;
  private marqueeTimer = 0;
  private dashOffset = 0;

  /** 获取当前选区信息（供剪切板操作使用） */
  getSelection(): { x: number; y: number; w: number; h: number } | null {
    if (this.mode !== "selected" || this.selW < 2 || this.selH < 2) return null;
    return { x: this.selX, y: this.selY, w: this.selW, h: this.selH };
  }

  /** 全选画布（供 Ctrl+A 使用） */
  selectAll(ctx: ToolContext) {
    this.mode = "selected";
    this.selX = 0;
    this.selY = 0;
    this.selW = ctx.buffer.width;
    this.selH = ctx.buffer.height;
    this.drawMarquee(ctx);
  }

  onActivate(_ctx: ToolContext) {
    this.mode = "idle";
    this.startMarquee();
  }

  onDeactivate() {
    this.stopMarquee();
    this.clearOverlay();
    this.mode = "idle";
  }

  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext) {
    const rx = Math.round(e.x),
      ry = Math.round(e.y);

    if (this.mode === "selected") {
      // 检查是否点击在选区内 → 移动模式
      if (
        rx >= this.selX &&
        rx <= this.selX + this.selW &&
        ry >= this.selY &&
        ry <= this.selY + this.selH
      ) {
        this.mode = "moving";
        this.moveStartX = rx;
        this.moveStartY = ry;
        // 保存选区像素用于 undo
        this.selectedPixels = ctx.buffer.getImageData(
          this.selX,
          this.selY,
          this.selW,
          this.selH,
        );
        return;
      }
      // 点击选区外 → 提交选区 → 取消选择
      this.clearSelection(ctx);
      this.mode = "idle";
      this.clearOverlay();
      return;
    }

    // idle → selecting
    this.mode = "selecting";
    this.startX = rx;
    this.startY = ry;
    this.selX = rx;
    this.selY = ry;
    this.selW = 0;
    this.selH = 0;
  }

  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext) {
    const rx = Math.round(e.x),
      ry = Math.round(e.y);

    if (this.mode === "selecting") {
      this.selX = Math.min(this.startX, rx);
      this.selY = Math.min(this.startY, ry);
      this.selW = Math.abs(rx - this.startX);
      this.selH = Math.abs(ry - this.startY);
      this.drawMarquee(ctx);
      return;
    }

    if (this.mode === "moving" && this.selectedPixels) {
      const dx = rx - this.moveStartX,
        dy = ry - this.moveStartY;
      this.selX += dx;
      this.selY += dy;
      this.moveStartX = rx;
      this.moveStartY = ry;
      this.drawMarquee(ctx);
      return;
    }
  }

  onPointerUp(_e: CanvasPointerEvent, ctx: ToolContext) {
    if (this.mode === "selecting") {
      if (this.selW < 2 && this.selH < 2) {
        // 太小视为点击取消选区
        this.selW = 0;
        this.selH = 0;
        this.mode = "idle";
        this.clearOverlay();
        return;
      }
      this.mode = "selected";
      this.drawMarquee(ctx);
      return;
    }

    if (this.mode === "moving" && this.selectedPixels) {
      // 擦除原选区 → 粘贴到新位置
      const beforeErase = ctx.buffer.getImageData(
        0,
        0,
        ctx.buffer.width,
        ctx.buffer.height,
      );
      ctx.buffer.ctx.fillStyle = ctx.state.bgColor;
      ctx.buffer.ctx.fillRect(this.selX, this.selY, this.selW, this.selH);
      // 粘贴到新位置
      ctx.buffer.ctx.putImageData(this.selectedPixels, this.selX, this.selY);
      const afterMove = ctx.buffer.getImageData(
        0,
        0,
        ctx.buffer.width,
        ctx.buffer.height,
      );

      ctx.commands.execute({
        type: "selection",
        bbox: { x: 0, y: 0, w: ctx.buffer.width, h: ctx.buffer.height },
        before: beforeErase,
        after: afterMove,
        apply: (c) => {
          c.putImageData(afterMove, 0, 0);
        },
        revert: (c) => {
          c.putImageData(beforeErase, 0, 0);
        },
      });

      this.selectedPixels = null;
      this.mode = "selected";
      this.drawMarquee(ctx);
      window.dispatchEvent(new Event("canvas-render"));
      return;
    }
  }

  /** 在 Overlay 层绘制走马灯选区框 */
  private drawMarquee(ctx: ToolContext) {
    const oc = ctx.overlayCtx;
    if (!oc || this.selW <= 0 || this.selH <= 0) return;
    if (
      this.mode !== "selecting" &&
      this.mode !== "selected" &&
      this.mode !== "moving"
    )
      return;

    // 清除 overlay → 绘制像素对齐的虚线框
    oc.clearRect(0, 0, oc.canvas.width, oc.canvas.height);

    // 将逻辑坐标转为 overlay 上的像素坐标（需知道 overlay 相对于 buffer 的映射）
    // Overlay 层是像素对齐的，需要应用 zoom + offset
    const scale = ctx.transform.zoom * ctx.transform.dpr;
    const ox = ctx.transform.offsetX;
    const oy = ctx.transform.offsetY;

    oc.strokeStyle = "#fff";
    oc.lineWidth = 1;
    oc.setLineDash([5, 3]);
    oc.lineDashOffset = this.dashOffset;
    oc.strokeRect(
      this.selX * scale + ox,
      this.selY * scale + oy,
      this.selW * scale,
      this.selH * scale,
    );
    oc.setLineDash([]);
  }

  private clearOverlay() {
    // 通过全局方式清理 overlay（由 CanvasSurface 的 rAF 循环处理）
    // 这里简单不做清理，等待下次绘制
    this.selW = 0;
    this.selH = 0;
  }

  private clearSelection(_ctx: ToolContext) {
    // 提交选区编辑（暂无操作则直接丢弃）
    this.selW = 0;
    this.selH = 0;
    this.selectedPixels = null;
    this.mode = "idle";
  }

  /** 走马灯动画定时器 */
  private startMarquee() {
    this.stopMarquee();
    this.dashOffset = 0;
    this.marqueeTimer = window.setInterval(() => {
      this.dashOffset = (this.dashOffset + 0.5) % 16;
    }, 50);
  }

  private stopMarquee() {
    if (this.marqueeTimer) {
      clearInterval(this.marqueeTimer);
      this.marqueeTimer = 0;
    }
  }
}
