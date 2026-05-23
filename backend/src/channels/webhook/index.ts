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
