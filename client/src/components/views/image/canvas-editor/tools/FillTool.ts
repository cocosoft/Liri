// canvas-editor/tools/FillTool.ts — 填充（Scanline Fill + Web Worker + 超时降级）

import { CanvasTool, CanvasPointerEvent } from "../types";
import { CanvasToolHandler, ToolContext } from "./base";

/** 解析 CSS 颜色字符串为 RGBA */
function parseColor(color: string): [number, number, number, number] {
  const c = new Option().style;
  c.color = color;
  const m = c.color.match(
    /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/,
  );
  if (!m) return [0, 0, 0, 255];
  return [
    parseInt(m[1]),
    parseInt(m[2]),
    parseInt(m[3]),
    m[4] ? Math.round(parseFloat(m[4]) * 255) : 255,
  ];
}

/** 比较两个 RGBA 颜色是否一致 */
function matchColor(
  data: Uint8ClampedArray,
  idx: number,
  r: number,
  g: number,
  b: number,
  a: number,
): boolean {
  return (
    data[idx] === r &&
    data[idx + 1] === g &&
    data[idx + 2] === b &&
    data[idx + 3] === a
  );
}

/** Scanline Fill — 主线程直接执行（小画布 < 200×200 或 Worker 超时降级） */
function scanlineFill(
  imageData: ImageData,
  startX: number,
  startY: number,
  fillR: number,
  fillG: number,
  fillB: number,
  fillA: number,
) {
  const { width, height, data } = imageData;
  const idx = (startY * width + startX) * 4;
  const targetR = data[idx],
    targetG = data[idx + 1],
    targetB = data[idx + 2],
    targetA = data[idx + 3];

  if (
    targetR === fillR &&
    targetG === fillG &&
    targetB === fillB &&
    targetA === fillA
  )
    return;

  const stack: [number, number, number, number][] = [];
  stack.push([startX, startX, startY, 0]);

  while (stack.length > 0) {
    const item = stack.pop()!;
    let [x1, x2, y] = item;

    let lx = x1;
    while (
      lx > 0 &&
      matchColor(
        data,
        (y * width + (lx - 1)) * 4,
        targetR,
        targetG,
        targetB,
        targetA,
      )
    )
      lx--;

    let rx = x2;
    while (
      rx < width - 1 &&
      matchColor(
        data,
        (y * width + (rx + 1)) * 4,
        targetR,
        targetG,
        targetB,
        targetA,
      )
    )
      rx++;

    for (let x = lx; x <= rx; x++) {
      const i = (y * width + x) * 4;
      data[i] = fillR;
      data[i + 1] = fillG;
      data[i + 2] = fillB;
      data[i + 3] = fillA;
    }

    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= height) continue;
      let nx = lx;
      while (nx <= rx) {
        while (
          nx <= rx &&
          !matchColor(
            data,
            (ny * width + nx) * 4,
            targetR,
            targetG,
            targetB,
            targetA,
          )
        )
          nx++;
        if (nx > rx) break;
        const nsx = nx;
        while (
          nx <= rx &&
          matchColor(
            data,
            (ny * width + nx) * 4,
            targetR,
            targetG,
            targetB,
            targetA,
          )
        )
          nx++;
        stack.push([nsx, nx - 1, ny, ny - y]);
      }
    }
  }
}

// Worker 相关
let fillWorker: Worker | null = null;
let workerIdleTimer: ReturnType<typeof setTimeout> | null = null;

/** 获取或创建 Worker 实例（30s 无操作自动销毁） */
function getWorker(): Worker {
  if (!fillWorker) {
    fillWorker = new Worker(
      new URL("../core/floodFill.worker.ts", import.meta.url),
      { type: "module" },
    );
  }
  // 重置空闲销毁计时器
  if (workerIdleTimer) clearTimeout(workerIdleTimer);
  workerIdleTimer = setTimeout(() => {
    fillWorker?.terminate();
    fillWorker = null;
    workerIdleTimer = null;
  }, 30_000);
  return fillWorker;
}

/** 通过 Worker 异步执行填充（带 200ms 超时降级） */
function workerFill(
  imageData: ImageData,
  x: number,
  y: number,
  fr: number,
  fg: number,
  fb: number,
  fa: number,
): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const worker = getWorker();
    const timeout = setTimeout(() => reject(new Error("timeout")), 200);

    const handleMsg = (e: MessageEvent) => {
      clearTimeout(timeout);
      worker.removeEventListener("message", handleMsg);
      if (e.data.type === "done") resolve(e.data.imageData);
      else reject(new Error(e.data.reason));
    };

    worker.addEventListener("message", handleMsg);
    worker.postMessage({
      imageData,
      x,
      y,
      fillR: fr,
      fillG: fg,
      fillB: fb,
      fillA: fa,
    });
  });
}

export class FillTool implements CanvasToolHandler {
  readonly id: CanvasTool = "fill";
  readonly cursor = "crosshair";

  onPointerDown(_e: CanvasPointerEvent, _ctx: ToolContext) {}
  onPointerMove(_e: CanvasPointerEvent, _ctx: ToolContext) {}

  async onPointerUp(e: CanvasPointerEvent, ctx: ToolContext) {
    const x = Math.round(e.x),
      y = Math.round(e.y);
    if (x < 0 || x >= ctx.buffer.width || y < 0 || y >= ctx.buffer.height)
      return;

    const { width, height } = ctx.buffer;
    const [fr, fg, fb, fa] = parseColor(ctx.state.fgColor);

    // 全画布快照（before 用于 undo）
    const before = ctx.buffer.getImageData(0, 0, width, height);
    const imageData = ctx.buffer.getImageData(0, 0, width, height);

    // 小画布直接主线程，大画布走 Worker
    if (width * height <= 200 * 200) {
      scanlineFill(imageData, x, y, fr, fg, fb, fa);
    } else {
      // 填充进度遮罩
      const oc = ctx.overlayCtx;
      if (oc) {
        oc.save();
        oc.setTransform(1, 0, 0, 1, 0, 0);
        oc.fillStyle = "rgba(0,0,0,0.35)";
        oc.fillRect(0, 0, oc.canvas.width, oc.canvas.height);
        oc.fillStyle = "rgba(255,255,255,0.9)";
        oc.font = "14px sans-serif";
        oc.textAlign = "center";
        oc.textBaseline = "middle";
        oc.fillText("填充中...", oc.canvas.width / 2, oc.canvas.height / 2);
        oc.restore();
      }
      try {
        const result = await workerFill(imageData, x, y, fr, fg, fb, fa);
        imageData.data.set(result.data);
      } catch {
        scanlineFill(imageData, x, y, fr, fg, fb, fa);
      }
      // 清除遮罩
      if (oc) {
        oc.setTransform(1, 0, 0, 1, 0, 0);
        oc.clearRect(0, 0, oc.canvas.width, oc.canvas.height);
      }
    }

    ctx.buffer.putImageData(imageData, 0, 0);
    const after = ctx.buffer.getImageData(0, 0, width, height);

    ctx.commands.execute({
      type: "fill",
      bbox: { x: 0, y: 0, w: width, h: height },
      before,
      after,
      apply: (c) => {
        c.putImageData(after, 0, 0);
      },
      revert: (c) => {
        c.putImageData(before, 0, 0);
      },
    });

    // Worker 异步完成，手动触发渲染
    window.dispatchEvent(new Event("canvas-render"));
  }
}
