// canvas-editor/core/OffscreenBuffer.ts — 1:1 持久像素缓冲区

export class OffscreenBuffer {
  private buffer: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;

  constructor(width: number, height: number) {
    this.buffer = new OffscreenCanvas(width, height);
    const ctx = this.buffer.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Failed to create OffscreenBuffer context");
    this.ctx = ctx;
  }

  get width() { return this.buffer.width; }
  get height() { return this.buffer.height; }

  getImageData(x: number, y: number, w: number, h: number) {
    try {
      return this.ctx.getImageData(x, y, w, h);
    } catch (e) {
      // IndexSizeError: 选区超出画布边界 → 自动缩小到安全尺寸
      if (e instanceof DOMException && e.name === "IndexSizeError") {
        const sx = Math.max(0, Math.min(x, this.width - 1));
        const sy = Math.max(0, Math.min(y, this.height - 1));
        const sw = Math.max(1, Math.min(w, this.width - sx));
        const sh = Math.max(1, Math.min(h, this.height - sy));
        return this.ctx.getImageData(sx, sy, sw, sh);
      }
      throw e;
    }
  }

  putImageData(data: ImageData, x: number, y: number) {
    this.ctx.putImageData(data, x, y);
  }

  getSource(): CanvasImageSource { return this.buffer as unknown as CanvasImageSource; }

  resize(w: number, h: number) {
    if (w === this.width && h === this.height) return;
    const old = this.ctx.getImageData(0, 0, Math.min(this.width, w), Math.min(this.height, h));
    this.buffer = new OffscreenCanvas(w, h);
    const ctx = this.buffer.getContext("2d", { willReadFrequently: true })!;
    this.ctx = ctx;
    if (old.width > 0 && old.height > 0) ctx.putImageData(old, 0, 0);
  }

  fillBg(color: string) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  /** 导出为 Blob（支持 PNG/JPEG/WebP） */
  async toBlob(format: "png" | "jpeg" | "webp" = "png", quality?: number): Promise<Blob> {
    return this.buffer.convertToBlob({ type: `image/${format}`, quality });
  }

  /** 导出为 DataURL */
  async toDataURL(format: "png" | "jpeg" | "webp" = "png", quality?: number): Promise<string> {
    const blob = await this.toBlob(format, quality);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}
