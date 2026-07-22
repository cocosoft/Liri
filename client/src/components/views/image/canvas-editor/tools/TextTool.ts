// canvas-editor/tools/TextTool.ts — 文字工具

import { CanvasTool, CanvasPointerEvent } from "../types";
import { CanvasToolHandler, ToolContext } from "./base";

export class TextTool implements CanvasToolHandler {
  readonly id: CanvasTool = "text";
  readonly cursor = "text";

  private textarea: HTMLTextAreaElement | null = null;
  private textX = 0;
  private textY = 0;
  private fontSize = 20;
  private fontFamily = '"PingFang SC", "Microsoft YaHei", sans-serif';
  private isComposing = false;

  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext) {
    this.removeTextarea();
    this.textX = Math.round(e.x);
    this.textY = Math.round(e.y);
    this.fontSize = ctx.state.strokeWidth * 6;

    const ta = document.createElement("textarea");
    ta.style.position = "fixed";
    // 使用 overlay canvas 的 viewport 位置 + 逻辑坐标偏移来精确定位
    const [px, py] = ctx.transform.logicalToPixel(this.textX, this.textY);
    const dpr = ctx.transform.dpr || 1;
    const rect = ctx.overlayCanvas?.getBoundingClientRect();
    if (rect) {
      ta.style.left = rect.left + px / dpr + "px";
      ta.style.top = rect.top + py / dpr + "px";
    } else {
      ta.style.left = px / dpr + "px";
      ta.style.top = py / dpr + "px";
    }
    ta.style.fontSize = this.fontSize + "px";
    ta.style.fontFamily = this.fontFamily;
    ta.style.color = ctx.state.fgColor;
    ta.style.background = "transparent";
    ta.style.border = "1px dashed rgba(128,128,128,0.5)";
    ta.style.outline = "none";
    ta.style.resize = "both";
    ta.style.minWidth = "40px";
    ta.style.minHeight = String(this.fontSize + 8) + "px";
    ta.style.padding = "0";
    ta.style.margin = "0";
    ta.style.overflow = "hidden";
    ta.style.zIndex = "9999";
    ta.style.caretColor = ctx.state.fgColor;
    ta.style.animation = "canvas-caret-blink 1s step-end infinite";
    ta.spellcheck = false;

    // 注入 caret 闪烁动画（仅一次）
    if (!document.getElementById("canvas-text-caret-style")) {
      const style = document.createElement("style");
      style.id = "canvas-text-caret-style";
      style.textContent =
        "@keyframes canvas-caret-blink{0%,100%{caret-color:transparent}50%{caret-color:currentColor}}";
      document.head.appendChild(style);
    }

    ta.addEventListener("compositionstart", () => {
      this.isComposing = true;
    });
    ta.addEventListener("compositionend", () => {
      this.isComposing = false;
    });
    ta.addEventListener("blur", () => this.commit(ctx));
    ta.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        this.removeTextarea();
      } else if (ev.key === "Enter" && !ev.shiftKey && !this.isComposing) {
        ev.preventDefault();
        this.commit(ctx);
      }
    });

    document.body.appendChild(ta);
    ta.focus();
    this.textarea = ta;
  }

  private commit(ctx: ToolContext) {
    if (!this.textarea) return;
    // XSS 防护：剥离 HTML 标签，仅保留纯文本
    const raw = this.textarea.value;
    const text = raw.replace(/<[^>]*>/g, "");
    this.removeTextarea();
    if (!text) return;

    const c = ctx.buffer.ctx;
    const fy = this.textY + this.fontSize;
    c.font = `${this.fontSize}px ${this.fontFamily}`;
    c.fillStyle = ctx.state.fgColor;
    const metrics = c.measureText(text);
    const w = Math.ceil(metrics.width) + 4;
    const h = this.fontSize + 8;

    const before = ctx.buffer.getImageData(this.textX, this.textY, w, h);
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      c.fillText(line, this.textX + 2, fy + i * (this.fontSize * 1.2));
    });
    const after = ctx.buffer.getImageData(this.textX, this.textY, w, h);

    ctx.commands.execute({
      type: "text",
      bbox: { x: this.textX, y: this.textY, w, h },
      before,
      after,
      apply: (c2) => {
        c2.putImageData(after, this.textX, this.textY);
      },
      revert: (c2) => {
        c2.putImageData(before, this.textX, this.textY);
      },
    });
  }

  private removeTextarea() {
    if (this.textarea) {
      this.textarea.remove();
      this.textarea = null;
    }
  }

  onPointerMove(_e: CanvasPointerEvent, _ctx: ToolContext) {}
  onPointerUp(_e: CanvasPointerEvent, _ctx: ToolContext) {}
  onDeactivate() {
    this.removeTextarea();
  }
}
