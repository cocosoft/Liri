// canvas-editor/core/floodFill.worker.ts — Web Worker: Scanline Fill
// 接收主线程 ImageData 并执行填充，通过 postMessage 返回结果

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

/** Scanline Fill（与主线程 FillTool 共用算法） */
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

// Worker 入口
self.onmessage = (
  e: MessageEvent<{
    imageData: ImageData;
    x: number;
    y: number;
    fillR: number;
    fillG: number;
    fillB: number;
    fillA: number;
  }>,
) => {
  const { imageData, x, y, fillR, fillG, fillB, fillA } = e.data;
  try {
    scanlineFill(imageData, x, y, fillR, fillG, fillB, fillA);
    self.postMessage({ type: "done", imageData });
  } catch (err) {
    self.postMessage({ type: "error", reason: String(err) });
  }
};
