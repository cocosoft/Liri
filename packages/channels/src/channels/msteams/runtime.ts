/**
 * Microsoft Teams 通道运行时模块
 * 对标 OpenClaw extensions/msteams/src/runtime.ts
 *
 * 提供运行时存储，管理运行时状态与子模块引用。
 */

/** 运行时状态 */
export type MSTeamsRuntimeStatus = 'idle' | 'active' | 'error';

/** Teams 运行时类型 */
export type MSTeamsRuntime = {
  status: MSTeamsRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: MSTeamsRuntime | null = null;

/**
 * 设置运行时实例
 */
export function setMSTeamsRuntime(runtime: MSTeamsRuntime): void {
  _runtime = runtime;
}

/**
 * 获取运行时实例
 */
export function getMSTeamsRuntime(): MSTeamsRuntime {
  if (!_runtime) {
    throw new Error('Teams runtime 未初始化');
  }
  return _runtime;
}

/**
 * 清除运行时实例
 */
export function clearMSTeamsRuntime(): void {
  _runtime = null;
}
