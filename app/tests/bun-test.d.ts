/**
 * 最小 bun:test 类型声明
 *
 * 背景：tests/ 长期被 tsconfig exclude，未纳入 typecheck。专项将其纳入覆盖时，
 * 若引入 @types/bun 会导致其全局类型（process/fetch/net 等）与生产代码类型环境
 * 冲突（已实测 IrcChannel null 收紧、process.on 事件名漂移、fetch 缺 preconnect
 * 等 18 处）。因此手写本声明，仅覆盖 tests/ 实际使用的 bun:test API 子集，
 * 不引入任何全局类型污染。
 *
 * 维护约定：新增 bun:test API 用法时，在此同步补充。
 *
 * 声明合并说明：src/ink/ink/global.d.ts（Ink 组件自带，属生产代码，不可修改）
 * 亦声明了简化版 `declare module 'bun:test'`（`expect(value: unknown): any`、
 * `test/describe: (name, fn) => void`）。两个 ambient module 声明合并时，
 * `const` 声明会被其中的 `function` 声明覆盖，导致 stringContaining/skip 等
 * 增强属性丢失。因此 test/describe/expect 改用 TS 标准的 function + namespace
 * 声明合并机制：function 声明与 Ink 的 function 声明合并为重载（兼容），
 * namespace 提供增强属性（skip/skipIf/stringContaining 等）。
 */
declare module 'bun:test' {
  // ── 生命周期 hooks ──
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;

  // ── 测试定义 ──
  export interface TestCtx {
    [key: string]: unknown;
  }
  export type TestBody = (ctx: TestCtx) => void | Promise<void>;

  export function test(name: string, fn: TestBody, timeout?: number): void;
  export namespace test {
    function skip(name: string, fn: TestBody): void;
    function skipIf(
      condition: boolean | (() => boolean)
    ): (name: string, fn: TestBody, timeout?: number) => void;
    function todo(name: string): void;
    function each(
      cases: ReadonlyArray<unknown>
    ): (name: string, fn: (...args: any[]) => void | Promise<void>) => void;
  }

  export const it: typeof test;

  export function describe(name: string, fn: () => void): void;
  export namespace describe {
    function skip(name: string, fn: () => void): void;
    function skipIf(
      condition: boolean | (() => boolean)
    ): (name: string, fn: () => void) => void;
    function each(
      cases: ReadonlyArray<unknown>
    ): (name: string, fn: (...args: any[]) => void | Promise<void>) => void;
  }

  // ── mock ──
  export interface Mock<T = unknown> {
    (...args: unknown[]): T;
    mock: {
      calls: unknown[][];
      instances: unknown[];
      results: unknown[];
      lastCall?: unknown[];
    };
    mockReturnValue(value: T): Mock<T>;
    mockReturnValueOnce(value: T): Mock<T>;
    mockImplementation(fn: (...args: any[]) => T): Mock<T>;
    mockImplementationOnce(fn: (...args: any[]) => T): Mock<T>;
    mockResolvedValue(value: unknown): Mock<Promise<unknown>>;
    mockRejectedValue(value: unknown): Mock<Promise<unknown>>;
    mockRestore(): void;
    mockReset(): void;
    mockClear(): void;
  }

  export function mock<T = unknown, A extends unknown[] = unknown[]>(
    fn?: (...args: A) => T
  ): Mock<T>;
  export namespace mock {
    function module(
      path: string,
      factory: () => unknown,
      options?: { route?: boolean }
    ): void;
  }

  export function spyOn(obj: object, method: string): Mock;

  // ── expect ──
  export interface Matchers<T = unknown> {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toBeNull(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeNaN(): void;
    toBeString(): void;
    toBeGreaterThan(value: number): void;
    toBeLessThan(value: number): void;
    toBeGreaterThanOrEqual(value: number): void;
    toBeLessThanOrEqual(value: number): void;
    toBeCloseTo(value: number, digits?: number): void;
    toContain(value: unknown): void;
    toContainEqual(value: unknown): void;
    toHaveLength(value: number): void;
    toMatch(regexp: RegExp | string): void;
    toMatchObject(obj: object): void;
    toThrow(error?: unknown): void;
    toHaveBeenCalled(): void;
    toHaveBeenCalledTimes(count: number): void;
    toHaveBeenCalledWith(...args: unknown[]): void;
    toHaveBeenCalledOnce(): void;
    toHaveProperty(key: string, value?: unknown): void;
    toBeInstanceOf(ctor: new (...args: any[]) => unknown): void;
    not: Matchers<T>;
    rejects: Matchers<T>;
    resolves: Matchers<T>;
  }

  export function expect<T>(actual: T, message?: string): Matchers<T>;
  export namespace expect {
    function any(ctor: new (...args: unknown[]) => unknown): unknown;
    function anything(): unknown;
    function arrayContaining(items: unknown[]): unknown;
    function objectContaining(obj: object): unknown;
    function stringContaining(str: string): unknown;
    function stringMatching(regexp: RegExp | string): unknown;
  }

  // ── vitest 兼容（存量测试误用，bun 运行时容错）──
  export const vi: {
    fn: <T = unknown, A extends unknown[] = unknown[]>(
      impl?: (...args: A) => T
    ) => Mock<T>;
    spyOn: (obj: object, method: string) => Mock;
    mock: (path: string, factory?: unknown) => void;
    clearAllMocks: () => void;
    resetAllMocks: () => void;
    restoreAllMocks: () => void;
  };
}

// bun 运行时提供 import.meta.dir（Node/ESM 无此属性），测试文件使用它定位 fixtures
declare global {
  interface ImportMeta {
    dir: string;
  }
}

export {};
