/**
 * 飞书通道运行时模块
 * 对标 OpenClaw extensions/feishu/src/runtime.ts
 *
 * 提供运行时存储，管理运行时状态与子模块引用。
 */

/** 运行时状态 */
export type FeishuRuntimeStatus = 'idle' | 'active' | 'error';

/** 飞书运行时类型 */
export type FeishuRuntime = {
  status: FeishuRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: FeishuRuntime | null = null;

/**
 * 设置运行时实例
 */
export function setFeishuRuntime(runtime: FeishuRuntime): void {
  _runtime = runtime;
}

/**
 * 获取运行时实例
 */
export function getFeishuRuntime(): FeishuRuntime {
  if (!_runtime) {
    throw new Error('飞书 runtime 未初始化');
  }
  return _runtime;
}

/**
 * 清除运行时实例
 */
export function clearFeishuRuntime(): void {
  _runtime = null;
}
