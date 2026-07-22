// canvas-editor/core/CanvasTransform.ts — 坐标转换 + 缩放/平移状态

export class CanvasTransform {
  zoom = 1;
  offsetX = 0;
  offsetY = 0;
  dpr = 1;

  private listeners = new Set<() => void>();

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  setZoom(z: number) {
    this.zoom = Math.max(0.1, Math.min(8, z));
    this.notify();
  }
  setOffset(x: number, y: number) {
    this.offsetX = x;
    this.offsetY = y;
    this.notify();
  }

  logicalToPixel(lx: number, ly: number): [number, number] {
    return [
      lx * this.zoom * this.dpr + this.offsetX,
      ly * this.zoom * this.dpr + this.offsetY,
    ];
  }

  clientToLogical(cx: number, cy: number): [number, number] {
    return [
      (cx - this.offsetX) / (this.zoom * this.dpr),
      (cy - this.offsetY) / (this.zoom * this.dpr),
    ];
  }

  applyTransform(ctx: CanvasRenderingContext2D) {
    ctx.setTransform(
      this.zoom * this.dpr,
      0,
      0,
      this.zoom * this.dpr,
      this.offsetX,
      this.offsetY,
    );
  }

  resetTransform(ctx: CanvasRenderingContext2D) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  fitTo(
    containerW: number,
    containerH: number,
    canvasW: number,
    canvasH: number,
  ) {
    const z = Math.min(containerW / canvasW, containerH / canvasH);
    this.setZoom(z);
    this.setOffset(
      Math.round((containerW - canvasW * z) / 2),
      Math.round((containerH - canvasH * z) / 2),
    );
  }
}
