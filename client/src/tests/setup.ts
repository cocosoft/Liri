import "@testing-library/jest-dom";
import { afterEach, vi } from "vitest";
import { createTestT } from "./createTestT";

// jsdom 环境下每个测试后自动清理
afterEach(() => {
  document.body.innerHTML = "";
});

/**
 * TR-15 修复（2026-09-22）：`t` 由「返回裸 key」改为**读真实字典**（zh）。
 *
 * - **为何不 import 真实 i18n 实例**：会死锁（异步 `vi.mock` 工厂 + `i18n/index.ts` 对
 *   `react-i18next` 的 import 形成循环等待，已实测挂起 >105s）—— 见 TR-15 附注。
 * - **为何只读 `i18n/locales/zh.ts`**：它是**纯数据模块**（不 import react-i18next）⇒ 无环。
 * - **为何经 `globalThis` 传递**：`vi.mock` 工厂会被提升到文件顶部，工厂内**不能**引用
 *   setup 顶层的变量（会得到 undefined）；经 `globalThis` 在**调用时**读取即可绕开该限制，
 *   且无需 async hoisted（避免重蹈 TR-15 的异步坑）。
 * - **核心收益**：字典缺键/拼错/翻译写错会在 CI 中**暴露**（`createTestT` 缺键即抛错），
 *   而不是静默渲染成裸 key。
 */
type TestT = (key: string, arg2?: unknown, arg3?: unknown) => string;
const testTStore = globalThis as unknown as { __liriTestT?: TestT };
testTStore.__liriTestT = createTestT() as TestT;

// initReactI18next 必须有 type（i18next v26 use() 严格校验 module.type），
// 否则 i18n/index.ts 的 i18n.use(initReactI18next) 抛 "You are passing a wrong module!"（L-3242）
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, arg2?: unknown, arg3?: unknown): string => {
      const g = globalThis as unknown as { __liriTestT?: TestT };
      return g.__liriTestT ? g.__liriTestT(key, arg2, arg3) : key; // 兜底：setup 未执行完时（不应发生）退回裸 key
    },
    i18n: { changeLanguage: () => Promise.resolve(), language: "zh" },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// Polyfill Path2D for test environments (Vitest / jsdom)
// Node/jsdom does not provide the browser Canvas Path2D global.
// Minimal implementation that supports moveTo/lineTo/closePath so tests
// that instantiate Path2D won't throw ReferenceError.
const canvasGlobals = globalThis as unknown as {
  Path2D?: unknown;
  ImageData?: unknown;
};
if (typeof canvasGlobals.Path2D === "undefined") {
  canvasGlobals.Path2D = class Path2D {
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
  };
}

// Polyfill ImageData for test environments
// Needed by canvas editor tool tests that construct new ImageData(width, height).
if (typeof canvasGlobals.ImageData === "undefined") {
  canvasGlobals.ImageData = class ImageData {
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
  };
}
