/**
 * QQ 通道运行时模块
 * 对标 IRC runtime.ts 模式
 */

export type QQRuntimeStatus = 'idle' | 'active' | 'error';

export type QQRuntime = {
  status: QQRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: QQRuntime | null = null;

export function setQQRuntime(runtime: QQRuntime): void {
  _runtime = runtime;
}

export function getQQRuntime(): QQRuntime {
  if (!_runtime) {
    throw new Error('QQ runtime 未初始化');
  }
  return _runtime;
}

export function clearQQRuntime(): void {
  _runtime = null;
}
