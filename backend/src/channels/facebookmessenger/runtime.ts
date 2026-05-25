/**
 * Facebook Messenger 通道运行时模块
 * 对标 IRC runtime.ts 模式
 */

export type FacebookMessengerRuntimeStatus = 'idle' | 'active' | 'error';

export type FacebookMessengerRuntime = {
  status: FacebookMessengerRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: FacebookMessengerRuntime | null = null;

export function setFacebookMessengerRuntime(
  runtime: FacebookMessengerRuntime
): void {
  _runtime = runtime;
}

export function getFacebookMessengerRuntime(): FacebookMessengerRuntime {
  if (!_runtime) {
    throw new Error('FacebookMessenger runtime 未初始化');
  }
  return _runtime;
}

export function clearFacebookMessengerRuntime(): void {
  _runtime = null;
}
