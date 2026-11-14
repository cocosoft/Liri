/**
 * 微信通道运行时模块
 * 对标 IRC runtime.ts 模式
 */

export type WechatRuntimeStatus = 'idle' | 'active' | 'error';

export type WechatRuntime = {
  status: WechatRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: WechatRuntime | null = null;

export function setWechatRuntime(runtime: WechatRuntime): void {
  _runtime = runtime;
}

export function getWechatRuntime(): WechatRuntime {
  if (!_runtime) {
    throw new Error('Wechat runtime 未初始化');
  }
  return _runtime;
}

export function clearWechatRuntime(): void {
  _runtime = null;
}
