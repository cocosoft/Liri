/**
 * Nostr 通道运行时模块
 * 对标 IRC runtime.ts 模式
 */

export type NostrRuntimeStatus = 'idle' | 'active' | 'error';

export type NostrRuntime = {
  status: NostrRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: NostrRuntime | null = null;

export function setNostrRuntime(runtime: NostrRuntime): void {
  _runtime = runtime;
}

export function getNostrRuntime(): NostrRuntime {
  if (!_runtime) {
    throw new Error('Nostr runtime 未初始化');
  }
  return _runtime;
}

export function clearNostrRuntime(): void {
  _runtime = null;
}
