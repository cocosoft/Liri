/**
 * Zalo 通道运行时模块
 * 对标 IRC runtime.ts 模式
 */

export type ZaloRuntimeStatus = 'idle' | 'active' | 'error';

export type ZaloRuntime = {
  status: ZaloRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: ZaloRuntime | null = null;

export function setZaloRuntime(runtime: ZaloRuntime): void {
  _runtime = runtime;
}

export function getZaloRuntime(): ZaloRuntime {
  if (!_runtime) {
    throw new Error('Zalo runtime 未初始化');
  }
  return _runtime;
}

export function clearZaloRuntime(): void {
  _runtime = null;
}
