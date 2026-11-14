/**
 * Telegram 通道运行时模块
 * 对标 IRC runtime.ts 模式
 */

export type TelegramRuntimeStatus = 'idle' | 'active' | 'error';

export type TelegramRuntime = {
  status: TelegramRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: TelegramRuntime | null = null;

export function setTelegramRuntime(runtime: TelegramRuntime): void {
  _runtime = runtime;
}

export function getTelegramRuntime(): TelegramRuntime {
  if (!_runtime) {
    throw new Error('Telegram runtime 未初始化');
  }
  return _runtime;
}

export function clearTelegramRuntime(): void {
  _runtime = null;
}
