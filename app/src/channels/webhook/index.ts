/**
 * channels/webhook/index.ts - Webhook 通道导出
 */

export {
  WebhookChannel,
  webhookChannel,
  createWebhookChannel,
  webhookChannelPlugin,
} from './WebhookChannel.js';
export type { WebhookConfig, WebhookMessage } from './WebhookChannel.js';

export {
  getDefaultWebhookConfig,
  validateWebhookConfig,
} from './config-schema.js';
export type { WebhookConfig as WebhookChannelConfig } from './config-schema.js';

export {
  registerWebhookAccount,
  getWebhookAccount,
  resolveWebhookAccount,
  listWebhookAccountIds,
  removeWebhookAccount,
} from './accounts.js';
export type { WebhookAccount, ResolvedWebhookAccount } from './accounts.js';

export { WebhookMonitor } from './monitor.js';
export type {
  MonitorEvent as WebhookMonitorEvent,
  MonitorStats as WebhookMonitorStats,
} from './monitor.js';

export { diagnoseWebhook } from './doctor.js';
export type {
  DiagnosisResult as WebhookDiagnosisResult,
  WebhookDiagnosisContext,
} from './doctor.js';

export { webhookProbe } from './probe.js';
export type { ProbeResult as WebhookProbeResult } from './probe.js';

export {
  setWebhookRuntime,
  getWebhookRuntime,
  clearWebhookRuntime,
} from './runtime.js';
export type { WebhookRuntime, WebhookRuntimeStatus } from './runtime.js';
