/**
 * 微信机器人通道运行时模块
 * 对标 IRC runtime.ts 模式
 */

export type WechatBotRuntimeStatus = 'idle' | 'active' | 'error';

export type WechatBotRuntime = {
  status: WechatBotRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: WechatBotRuntime | null = null;

export function setWechatBotRuntime(runtime: WechatBotRuntime): void {
  _runtime = runtime;
}

export function getWechatBotRuntime(): WechatBotRuntime {
  if (!_runtime) {
    throw new Error('WechatBot runtime 未初始化');
  }
  return _runtime;
}

export function clearWechatBotRuntime(): void {
  _runtime = null;
}
