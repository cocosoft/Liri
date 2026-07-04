// canvas-editor/core/imageFilters.worker.ts — 图像滤镜 Worker（亮度/对比度/灰度/模糊）

type FilterOp =
  | { type: "brightness"; value: number }    // -255..255
  | { type: "contrast"; value: number }      // 0..200 (100=normal)
  | { type: "grayscale" }
  | { type: "blur"; value: number }          // 1..20
  | { type: "invert" };

type WorkerInput = { imageData: ImageData; filters: FilterOp[] };
type WorkerOutput = { result: ImageData } | { error: string };

function clamp(v: number) { return Math.max(0, Math.min(255, v)); }

function applyBrightness(data: Uint8ClampedArray, value: number) {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp(data[i] + value);
    data[i + 1] = clamp(data[i + 1] + value);
    data[i + 2] = clamp(data[i + 2] + value);
  }
}

function applyContrast(data: Uint8ClampedArray, value: number) {
  const factor = (259 * (value + 255)) / (255 * (259 - value));
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp(factor * (data[i] - 128) + 128);
    data[i + 1] = clamp(factor * (data[i + 1] - 128) + 128);
    data[i + 2] = clamp(factor * (data[i + 2] - 128) + 128);
  }
}

function applyGrayscale(data: Uint8ClampedArray) {
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = gray;
  }
}

function applyInvert(data: Uint8ClampedArray) {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
}

function applyBlur(data: Uint8ClampedArray, w: number, h: number, radius: number) {
  const copy = new Uint8ClampedArray(data);
  const r = Math.max(1, Math.min(radius, 20));
  // Box blur 近似
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = Math.min(w - 1, Math.max(0, x + dx));
          const ny = Math.min(h - 1, Math.max(0, y + dy));
          const idx = (ny * w + nx) * 4;
          rSum += copy[idx]; gSum += copy[idx + 1]; bSum += copy[idx + 2];
          count++;
        }
      }
      const idx = (y * w + x) * 4;
      data[idx] = rSum / count; data[idx + 1] = gSum / count; data[idx + 2] = bSum / count;
    }
  }
}

self.addEventListener("message", (e: MessageEvent<WorkerInput>) => {
  const { imageData, filters } = e.data;
  try {
    const data = new Uint8ClampedArray(imageData.data);
    const w = imageData.width;
    const h = imageData.height;

    for (const f of filters) {
      switch (f.type) {
        case "brightness": applyBrightness(data, f.value); break;
        case "contrast": applyContrast(data, f.value); break;
        case "grayscale": applyGrayscale(data); break;
        case "invert": applyInvert(data); break;
        case "blur": applyBlur(data, w, h, f.value || 3); break;
      }
    }

    const result = new ImageData(data, w, h);
    (self as unknown as { postMessage: (msg: WorkerOutput) => void }).postMessage({ result });
  } catch (err: unknown) {
    (self as unknown as { postMessage: (msg: WorkerOutput) => void }).postMessage({ error: String(err) });
  }
});
