/**
 * Webhook 通道运行时入口
 * 对标 IRC channel.runtime.ts 模式
 *
 * 在运行时边界聚合通道运行时功能，保持主入口加载轻量。
 */
export { WebhookMonitor } from './monitor.js';
export { diagnoseWebhook } from './doctor.js';
export { webhookProbe } from './probe.js';
