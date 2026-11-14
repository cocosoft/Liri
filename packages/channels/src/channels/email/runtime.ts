/**
 * 邮件通道运行时模块
 * 对标 OpenClaw extensions/irc/src/runtime.ts
 */

export type EmailRuntimeStatus = 'idle' | 'active' | 'error';

export type EmailRuntime = {
  status: EmailRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: EmailRuntime | null = null;

export function setEmailRuntime(runtime: EmailRuntime): void {
  _runtime = runtime;
}

export function getEmailRuntime(): EmailRuntime {
  if (!_runtime) {
    throw new Error('Email runtime 未初始化');
  }
  return _runtime;
}

export function clearEmailRuntime(): void {
  _runtime = null;
}
