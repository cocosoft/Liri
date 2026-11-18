/**
 * SMS 通道运行时模块
 * 对标 IRC runtime.ts 模式
 */

export type SmsRuntimeStatus = 'idle' | 'active' | 'error';

export type SmsRuntime = {
  status: SmsRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: SmsRuntime | null = null;

export function setSmsRuntime(runtime: SmsRuntime): void {
  _runtime = runtime;
}

export function getSmsRuntime(): SmsRuntime {
  if (!_runtime) {
    throw new Error('SMS runtime 未初始化');
  }
  return _runtime;
}

export function clearSmsRuntime(): void {
  _runtime = null;
}
