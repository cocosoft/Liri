/**
 * Webhook 通道运行时模块
 * 对标 IRC runtime.ts 模式
 */

export type WebhookRuntimeStatus = 'idle' | 'active' | 'error';

export type WebhookRuntime = {
  status: WebhookRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: WebhookRuntime | null = null;

export function setWebhookRuntime(runtime: WebhookRuntime): void {
  _runtime = runtime;
}

export function getWebhookRuntime(): WebhookRuntime {
  if (!_runtime) {
    throw new Error('Webhook runtime 未初始化');
  }
  return _runtime;
}

export function clearWebhookRuntime(): void {
  _runtime = null;
}
