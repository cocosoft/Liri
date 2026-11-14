/**
 * Signal 通道运行时模块
 * 对标 IRC runtime.ts 模式
 */

export type SignalRuntimeStatus = 'idle' | 'active' | 'error';

export type SignalRuntime = {
  status: SignalRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: SignalRuntime | null = null;

export function setSignalRuntime(runtime: SignalRuntime): void {
  _runtime = runtime;
}

export function getSignalRuntime(): SignalRuntime {
  if (!_runtime) {
    throw new Error('Signal runtime 未初始化');
  }
  return _runtime;
}

export function clearSignalRuntime(): void {
  _runtime = null;
}
