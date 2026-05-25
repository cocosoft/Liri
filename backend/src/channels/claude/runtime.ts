/**
 * Claude 通道运行时模块
 * 对标 IRC runtime.ts 模式
 */

export type ClaudeRuntimeStatus = 'idle' | 'active' | 'error';

export type ClaudeRuntime = {
  status: ClaudeRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: ClaudeRuntime | null = null;

export function setClaudeRuntime(runtime: ClaudeRuntime): void {
  _runtime = runtime;
}

export function getClaudeRuntime(): ClaudeRuntime {
  if (!_runtime) {
    throw new Error('Claude runtime 未初始化');
  }
  return _runtime;
}

export function clearClaudeRuntime(): void {
  _runtime = null;
}
