/**
 * WhatsApp 通道运行时模块
 * 对标 IRC runtime.ts 模式
 */

export type WhatsAppRuntimeStatus = 'idle' | 'active' | 'error';

export type WhatsAppRuntime = {
  status: WhatsAppRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: WhatsAppRuntime | null = null;

export function setWhatsAppRuntime(runtime: WhatsAppRuntime): void {
  _runtime = runtime;
}

export function getWhatsAppRuntime(): WhatsAppRuntime {
  if (!_runtime) {
    throw new Error('WhatsApp runtime 未初始化');
  }
  return _runtime;
}

export function clearWhatsAppRuntime(): void {
  _runtime = null;
}
