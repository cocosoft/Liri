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

declare module '../context.js' {
  export function getSystemContext(): Promise<unknown>;
  export function getUserContext(): Promise<unknown>;
}

declare module './utils/gracefulShutdown.js' {
  export function registerShutdownHandler(
    handler: () => void | Promise<void>
  ): void;
  export function setupGracefulShutdown(): void;
  export function gracefulShutdown(): Promise<void>;
}

declare module './context.js' {
  export function getSystemContext(): Promise<unknown>;
  export function getUserContext(): Promise<unknown>;
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
