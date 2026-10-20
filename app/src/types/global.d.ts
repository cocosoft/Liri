/**
 * 全局类型声明
 */

declare module '../utils/gracefulShutdown.js' {
  export function registerShutdownHandler(
    handler: () => void | Promise<void>
  ): void;
  export function setupGracefulShutdown(): void;
  export function gracefulShutdown(): Promise<void>;
}

declare module './utils/gracefulShutdown.js' {
  export function registerShutdownHandler(
    handler: () => void | Promise<void>
  ): void;
  export function setupGracefulShutdown(): void;
  export function gracefulShutdown(): Promise<void>;
}

declare module '../tools/index.js' {
  export interface ToolManagerInterface {
    getAllTools(): unknown[];
  }
  export function getToolManager(): ToolManagerInterface | undefined;
}

// 2026-09-30（台账 D-83）：`ExtensibilityService` 已删除 ⇒ 其 ambient 声明（遗留 shim，
// 无其他引用方）一并移除。

declare module '../monitoring/index.js' {
  export interface MonitoringServiceInterface {
    start(): void;
    stop(): void;
  }
  export function getMonitoringService(): MonitoringServiceInterface;
}

/**
 * `bun:bundle` —— 编译期 feature 裁剪（2026-10-20，P1-0）。
 *
 * `bun build --feature=NAME` / `bun --feature=NAME` 时，未声明的分支会被常量折叠并从产物中
 * 整体删除（含其内部的动态 `import()` 目标）。
 *
 * ⚠️ 只能出现在 `if` / 三元**条件**位置：当值使用（`const v = feature('X')`、
 * `expect(feature('X'))`）会在运行时抛
 * `feature() from "bun:bundle" can only be used directly in an if statement or ternary condition`。
 * TS 类型无法表达该限制 ⇒ 由代码评审与使用处注释约束。
 */
declare module 'bun:bundle' {
  export function feature(name: string): boolean;
}
