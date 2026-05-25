/**
 * 企业微信通道运行时模块
 * 对标 IRC runtime.ts 模式
 */

export type WeComRuntimeStatus = 'idle' | 'active' | 'error';

export type WeComRuntime = {
  status: WeComRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: WeComRuntime | null = null;

export function setWeComRuntime(runtime: WeComRuntime): void {
  _runtime = runtime;
}

export function getWeComRuntime(): WeComRuntime {
  if (!_runtime) {
    throw new Error('WeCom runtime 未初始化');
  }
  return _runtime;
}

export function clearWeComRuntime(): void {
  _runtime = null;
}
