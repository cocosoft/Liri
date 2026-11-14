/**
 * 元宝通道运行时模块
 * 对标 IRC runtime.ts 模式
 */

export type YuanbaoRuntimeStatus = 'idle' | 'active' | 'error';

export type YuanbaoRuntime = {
  status: YuanbaoRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: YuanbaoRuntime | null = null;

export function setYuanbaoRuntime(runtime: YuanbaoRuntime): void {
  _runtime = runtime;
}

export function getYuanbaoRuntime(): YuanbaoRuntime {
  if (!_runtime) {
    throw new Error('Yuanbao runtime 未初始化');
  }
  return _runtime;
}

export function clearYuanbaoRuntime(): void {
  _runtime = null;
}
