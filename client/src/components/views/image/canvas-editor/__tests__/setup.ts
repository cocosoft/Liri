// __tests__/setup.ts — Canvas API mock + Worker blob: URL 测试基线

// jest-canvas-mock 由 jest.config 的 setupFiles 注入
// 此处定义自定义扩展

// Mock Web Worker（blob: URL 加载）
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;

  constructor(_url: string | URL, _options?: WorkerOptions) {}

  postMessage(data: unknown) {
    // 延迟模拟异步 Worker 响应
    setTimeout(() => {
      this.onmessage?.({ data } as MessageEvent);
    }, 0);
  }

  terminate() {}
}

(globalThis as Record<string, unknown>).Worker = MockWorker;

// Mock URL.createObjectURL / revokeObjectURL
(globalThis as Record<string, unknown>).URL = {
  ...URL,
  createObjectURL: jest.fn(() => "blob:mock"),
  revokeObjectURL: jest.fn(),
};

// Mock OffscreenCanvas
class MockOffscreenCanvas {
  width: number; height: number;
  constructor(w: number, h: number) { this.width = w; this.height = h; }
  getContext(_type: string) {
    return {
      putImageData: jest.fn(),
      drawImage: jest.fn(),
      fillRect: jest.fn(),
      stroke: jest.fn(),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
    };
  }
  convertToBlob() { return Promise.resolve(new Blob()); }
}

(globalThis as Record<string, unknown>).OffscreenCanvas = MockOffscreenCanvas;
