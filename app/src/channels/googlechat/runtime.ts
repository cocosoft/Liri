/**
 * Google Chat 通道运行时模块
 * 对标 OpenClaw extensions/googlechat/src/runtime.ts
 *
 * 提供运行时存储，管理运行时状态与子模块引用。
 */

/** 运行时状态 */
export type GoogleChatRuntimeStatus = 'idle' | 'active' | 'error';

/** Google Chat 运行时类型 */
export type GoogleChatRuntime = {
  status: GoogleChatRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: GoogleChatRuntime | null = null;

/**
 * 设置运行时实例
 */
export function setGoogleChatRuntime(runtime: GoogleChatRuntime): void {
  _runtime = runtime;
}

/**
 * 获取运行时实例
 */
export function getGoogleChatRuntime(): GoogleChatRuntime {
  if (!_runtime) {
    throw new Error('Google Chat runtime 未初始化');
  }
  return _runtime;
}

/**
 * 清除运行时实例
 */
export function clearGoogleChatRuntime(): void {
  _runtime = null;
}
