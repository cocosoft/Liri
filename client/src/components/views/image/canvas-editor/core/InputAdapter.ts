// canvas-editor/core/InputAdapter.ts — 统一鼠标/触摸事件 + 手势

import { CanvasPointerEvent } from "../types";
import { CanvasTransform } from "./CanvasTransform";

interface GestureHandlers {
  /** 双指捏合缩放 */
  onPinchZoom?: (ratio: number, cx: number, cy: number) => void;
  /** 双指平移 */
  onTwoFingerPan?: (dx: number, dy: number) => void;
  /** 双击 100% */
  onDoubleTap?: (cx: number, cy: number) => void;
}

export class InputAdapter {
  private pointers = new Map<number, { clientX: number; clientY: number }>();
  private prevPinchDist = 0;
  private prevMidX = 0;
  private prevMidY = 0;
  private lastTapTime = 0;
  private lastTapX = 0;
  private lastTapY = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private transform: CanvasTransform,
    private handlers: {
      onPointerDown?: (e: CanvasPointerEvent) => void;
      onPointerMove?: (e: CanvasPointerEvent) => void;
      onPointerUp?: (e: CanvasPointerEvent) => void;
    },
    private gestureHandlers?: GestureHandlers,
  ) {
    this.setup();
  }

  private adapt(e: PointerEvent): CanvasPointerEvent {
    const [x, y] = this.transform.clientToLogical(e.offsetX, e.offsetY);
    return {
      x,
      y,
      button: e.button,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      pressure: e.pressure,
    };
  }

  private getPointerArray(): { clientX: number; clientY: number }[] {
    return Array.from(this.pointers.values());
  }

  private updateGesture() {
    const pts = this.getPointerArray();
    if (pts.length < 2) return;

    const dx = pts[0].clientX - pts[1].clientX;
    const dy = pts[0].clientY - pts[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const midX = (pts[0].clientX + pts[1].clientX) / 2;
    const midY = (pts[0].clientY + pts[1].clientY) / 2;

    if (this.prevPinchDist > 0 && this.gestureHandlers?.onPinchZoom) {
      const ratio = dist / this.prevPinchDist;
      this.gestureHandlers.onPinchZoom(ratio, midX, midY);
    }

    if (this.gestureHandlers?.onTwoFingerPan) {
      const pdx = midX - this.prevMidX;
      const pdy = midY - this.prevMidY;
      if (this.prevMidX > 0) {
        this.gestureHandlers.onTwoFingerPan(pdx, pdy);
      }
    }

    this.prevPinchDist = dist;
    this.prevMidX = midX;
    this.prevMidY = midY;
  }

  private setup() {
    const el = this.canvas;
    el.style.touchAction = "none";

    el.addEventListener("pointerdown", (e: PointerEvent) => {
      this.pointers.set(e.pointerId, {
        clientX: e.clientX,
        clientY: e.clientY,
      });

      // 双指手势初始化
      if (this.pointers.size === 2) {
        const pts = this.getPointerArray();
        const dx = pts[0].clientX - pts[1].clientX;
        const dy = pts[0].clientY - pts[1].clientY;
        this.prevPinchDist = Math.sqrt(dx * dx + dy * dy);
        this.prevMidX = (pts[0].clientX + pts[1].clientX) / 2;
        this.prevMidY = (pts[0].clientY + pts[1].clientY) / 2;
        return; // 双指时不触发单指事件
      }

      // 双击检测
      const now = Date.now();
      if (
        now - this.lastTapTime < 300 &&
        Math.abs(e.clientX - this.lastTapX) < 20 &&
        Math.abs(e.clientY - this.lastTapY) < 20
      ) {
        this.gestureHandlers?.onDoubleTap?.(e.clientX, e.clientY);
        this.lastTapTime = 0;
        return;
      }
      this.lastTapTime = now;
      this.lastTapX = e.clientX;
      this.lastTapY = e.clientY;

      this.handlers.onPointerDown?.(this.adapt(e));
    });

    el.addEventListener("pointermove", (e: PointerEvent) => {
      // 更新指针位置
      const existing = this.pointers.get(e.pointerId);
      if (existing) {
        existing.clientX = e.clientX;
        existing.clientY = e.clientY;
      }

      // 双指手势
      if (this.pointers.size >= 2) {
        this.updateGesture();
        return;
      }

      this.handlers.onPointerMove?.(this.adapt(e));
    });

    el.addEventListener("pointerup", (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);

      if (this.pointers.size < 2) {
        this.prevPinchDist = 0;
        this.prevMidX = 0;
        this.prevMidY = 0;
      }

      this.handlers.onPointerUp?.(this.adapt(e));
    });
  }

  destroy() {
    /* cleanup if needed */
  }
}
