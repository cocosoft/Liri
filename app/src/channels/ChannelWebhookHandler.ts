/**
 * ChannelWebhookHandler — 轻量级 Proactive Loop Webhook 处理
 *
 * Phase 5（远期）：外部事件到达后自动触发 PDCA task。
 * 当前阶段仅做最简实现：事件监听 → 触发 PDCA → 通知结果。
 *
 * 不做的：多 Agent 流水线编排（DAG/并行/分支）— 留到 v2。
 */

import { Logger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';

const logger = new Logger({ module: 'channels:webhook' });

export interface WebhookEvent {
  channel: string;
  eventType: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface WebhookResult {
  handled: boolean;
  goalId?: string;
  error?: string;
}

/**
 * 处理入站 webhook 事件
 * 当前为 stub 实现：记录事件并返回待处理状态。
 * Phase 5 完整实现时接入 PDCA trigger。
 */
export async function handleWebhookEvent(
  event: WebhookEvent
): Promise<WebhookResult> {
  const otel = getOTelTracing();
  const span = otel.startSpan('proactive.webhook', {
    channel: event.channel,
    eventType: event.eventType,
  });

  try {
    logger.info('Webhook event received', {
      channel: event.channel,
      eventType: event.eventType,
    });

    // TODO: Phase 5 — 触发 PDCA task
    // const orchestrator = getOrCreateOrchestrator(`webhook_${Date.now().toString(36)}`);
    // await orchestrator.runFullPdca(event.payload.description || 'Process webhook event', sessionId);

    span.setAttribute('proactive.handled', true);
    span.end();
    return { handled: true };
  } catch (e) {
    logger.error('Webhook handler failed', {
      channel: event.channel,
      error: String(e),
    });
    span.end();
    return { handled: false, error: String(e) };
  }
}

logger.info('ChannelWebhookHandler initialized (stub)');
