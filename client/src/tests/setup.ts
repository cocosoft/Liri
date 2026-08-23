import "@testing-library/jest-dom";
import { afterEach, vi } from "vitest";

// jsdom 环境下每个测试后自动清理
afterEach(() => {
  document.body.innerHTML = "";
});

// Mock react-i18next 避免测试环境 NO_I18NEXT_INSTANCE 警告，保证 t() 返回原始 key
// initReactI18next 必须有 type（i18next v26 use() 严格校验 module.type），
// 否则 i18n/index.ts 的 i18n.use(initReactI18next) 抛 "You are passing a wrong module!"（L-3242）
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { changeLanguage: () => Promise.resolve(), language: "zh" },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// Polyfill Path2D for test environments (Vitest / jsdom)
// Node/jsdom does not provide the browser Canvas Path2D global.
// Minimal implementation that supports moveTo/lineTo/closePath so tests
// that instantiate Path2D won't throw ReferenceError.
if (typeof (globalThis as any).Path2D === "undefined") {
  (globalThis as any).Path2D = class Path2D {
    constructor() {
      /* no-op: minimal polyfill */
    }
    addPath(_path: unknown, _transform?: unknown) {
      /* no-op */
    }
    arc(
      _x: number,
      _y: number,
      _radius: number,
      _startAngle: number,
      _endAngle: number,
      _counterclockwise?: boolean,
    ) {
      /* no-op */
    }
    arcTo(_x1: number, _y1: number, _x2: number, _y2: number, _radius: number) {
      /* no-op */
    }
    bezierCurveTo(
      _cp1x: number,
      _cp1y: number,
      _cp2x: number,
      _cp2y: number,
      _x: number,
      _y: number,
    ) {
      /* no-op */
    }
    closePath() {
      /* no-op */
    }
    ellipse(
      _x: number,
      _y: number,
      _radiusX: number,
      _radiusY: number,
      _rotation: number,
      _startAngle: number,
      _endAngle: number,
      _counterclockwise?: boolean,
    ) {
      /* no-op */
    }
    lineTo(_x?: number, _y?: number) {
      /* no-op */
    }
    moveTo(_x?: number, _y?: number) {
      /* no-op */
    }
    quadraticCurveTo(_cpx: number, _cpy: number, _x: number, _y: number) {
      /* no-op */
    }
    rect(_x: number, _y: number, _w: number, _h: number) {
      /* no-op */
    }
    roundRect(_x: number, _y: number, _w: number, _h: number, _radii?: number) {
      /* no-op */
    }
  } as any;
}

// Polyfill ImageData for test environments
// Needed by canvas editor tool tests that construct new ImageData(width, height).
if (typeof (globalThis as any).ImageData === "undefined") {
  (globalThis as any).ImageData = class ImageData {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly colorSpace: string;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
      this.colorSpace = "srgb";
    }
  } as any;
}
