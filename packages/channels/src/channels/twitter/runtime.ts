/**
 * Twitter/X 通道运行时模块
 * 对标 IRC runtime.ts 模式
 */

export type TwitterRuntimeStatus = 'idle' | 'active' | 'error';

export type TwitterRuntime = {
  status: TwitterRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: TwitterRuntime | null = null;

export function setTwitterRuntime(runtime: TwitterRuntime): void {
  _runtime = runtime;
}

export function getTwitterRuntime(): TwitterRuntime {
  if (!_runtime) {
    throw new Error('Twitter runtime 未初始化');
  }
  return _runtime;
}

export function clearTwitterRuntime(): void {
  _runtime = null;
}
