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

declare module '../core/extensibility/index.js' {
  export interface ExtensibilityServiceInterface {
    init(): Promise<void>;
    startAllModules(): Promise<void>;
    shutdown(): Promise<void>;
  }
  export function getExtensibilityService(): ExtensibilityServiceInterface;
}

declare module '../monitoring/index.js' {
  export interface MonitoringServiceInterface {
    start(): void;
    stop(): void;
  }
  export function getMonitoringService(): MonitoringServiceInterface;
}
