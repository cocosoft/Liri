/**
 * LINE 通道运行时模块
 * 对标 OpenClaw extensions/line/src/runtime.ts
 *
 * 提供运行时存储，管理运行时状态与子模块引用。
 */

/** 运行时状态 */
export type LineRuntimeStatus = 'idle' | 'active' | 'error';

/** LINE 运行时类型 */
export type LineRuntime = {
  status: LineRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: LineRuntime | null = null;

/**
 * 设置运行时实例
 */
export function setLineRuntime(runtime: LineRuntime): void {
  _runtime = runtime;
}

/**
 * 获取运行时实例
 */
export function getLineRuntime(): LineRuntime {
  if (!_runtime) {
    throw new Error('LINE runtime 未初始化');
  }
  return _runtime;
}

/**
 * 清除运行时实例
 */
export function clearLineRuntime(): void {
  _runtime = null;
}
