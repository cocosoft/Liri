/**
 * Slack 通道运行时模块
 * 对标 IRC runtime.ts 模式
 */

export type SlackRuntimeStatus = 'idle' | 'active' | 'error';

export type SlackRuntime = {
  status: SlackRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: SlackRuntime | null = null;

export function setSlackRuntime(runtime: SlackRuntime): void {
  _runtime = runtime;
}

export function getSlackRuntime(): SlackRuntime {
  if (!_runtime) {
    throw new Error('Slack runtime 未初始化');
  }
  return _runtime;
}

export function clearSlackRuntime(): void {
  _runtime = null;
}
