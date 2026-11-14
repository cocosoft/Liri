/**
 * 钉钉通道运行时模块
 * 对标 IRC runtime.ts 模式
 */

export type DingTalkRuntimeStatus = 'idle' | 'active' | 'error';

export type DingTalkRuntime = {
  status: DingTalkRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: DingTalkRuntime | null = null;

export function setDingTalkRuntime(runtime: DingTalkRuntime): void {
  _runtime = runtime;
}

export function getDingTalkRuntime(): DingTalkRuntime {
  if (!_runtime) {
    throw new Error('DingTalk runtime 未初始化');
  }
  return _runtime;
}

export function clearDingTalkRuntime(): void {
  _runtime = null;
}
