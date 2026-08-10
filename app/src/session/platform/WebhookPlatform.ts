/**
 * WebhookPlatform — Webhook 平台适配器
 *
 * 通过 HTTP Webhook 发送/接收消息，用于外部服务集成。
 * 支持：
 * - POST webhook 发送消息
 * - 可配置重试与超时
 * - 消息队列与批量发送
 */

import { getLogger } from '@modules/monitoring';
import type {
  PlatformAdapter,
  PlatformConfig,
  PlatformSendResult,
  PlatformConnectionStatus,
  PlatformType,
} from './PlatformAdapter';
import type { UnifiedMessage } from '../types/Message';

const logger = getLogger('session:webhookPlatform');

export interface WebhookPlatformConfig extends PlatformConfig {
  settings: {
    webhookUrl?: string;
    secretToken?: string;
    retryCount?: number;
    retryDelayMs?: number;
    timeoutMs?: number;
    batchEndpoint?: string;
  };
}

export class WebhookPlatform implements PlatformAdapter {
  readonly platformName: string;
  readonly platformType: PlatformType = 'webhook';

  private config: WebhookPlatformConfig | null = null;
  private connected = false;
  private connectedAt = 0;
  private retryCount = 0;
  private lastError: string | undefined;

  private pendingQueue: Array<{
    sessionId: string;
    message: UnifiedMessage;
    retries: number;
  }> = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(name = 'webhook') {
    this.platformName = name;
  }

  async connect(config: PlatformConfig): Promise<void> {
    this.config = config as WebhookPlatformConfig;
    this.connected = true;
    this.connectedAt = Date.now();
    this.retryCount = 0;
    this.lastError = undefined;

    const settings = this.config.settings;
    const flushInterval = settings?.retryDelayMs ?? 5_000;

    this.flushTimer = setInterval(() => {
      this.flushPendingQueue();
    }, flushInterval);

    logger.info('Webhook 平台已连接', {
      name: this.platformName,
      webhookUrl: settings?.webhookUrl,
    });
  }

  async disconnect(): Promise<void> {
    this.connected = false;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flushPendingQueue();
    logger.info('Webhook 平台已断开', { name: this.platformName });
  }

  async sendMessage(
    sessionId: string,
    message: UnifiedMessage
  ): Promise<PlatformSendResult> {
    const payload = this.buildPayload(sessionId, message);

    try {
      const response = await this.httpPost(payload);
      const body = await response.text();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${body}`);
      }

      logger.info('Webhook 消息已发送', {
        sessionId,
        status: response.status,
      });

      return {
        success: true,
        platformMessageId: `wh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sentAt: Date.now(),
      };
    } catch (err) {
      const errorMessage = String(err);
      this.lastError = errorMessage;
      this.retryCount++;

      logger.warning('Webhook 发送失败，加入重试队列', {
        sessionId,
        error: errorMessage,
        retryCount: this.retryCount,
      });

      this.pendingQueue.push({ sessionId, message, retries: 0 });

      return {
        success: false,
        error: errorMessage,
        sentAt: Date.now(),
      };
    }
  }

  async sendBatch(
    sessionId: string,
    messages: UnifiedMessage[]
  ): Promise<PlatformSendResult[]> {
    const results: PlatformSendResult[] = [];

    for (const message of messages) {
      const result = await this.sendMessage(sessionId, message);
      results.push(result);
    }

    return results;
  }

  getConnectionStatus(): PlatformConnectionStatus {
    return {
      connected: this.connected,
      platform: this.platformType,
      name: this.platformName,
      connectedAt: this.connectedAt || undefined,
      lastError: this.lastError,
      retryCount: this.retryCount,
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  getPendingCount(): number {
    return this.pendingQueue.length;
  }

  private async flushPendingQueue(): Promise<void> {
    if (this.pendingQueue.length === 0) return;

    const batch = [...this.pendingQueue];
    this.pendingQueue = [];

    const settings = this.config?.settings;
    const maxRetries = settings?.retryCount ?? 3;

    for (const item of batch) {
      if (item.retries >= maxRetries) {
        logger.warning('Webhook 消息重试耗尽，丢弃', {
          sessionId: item.sessionId,
          retries: item.retries,
        });
        continue;
      }

      try {
        const payload = this.buildPayload(item.sessionId, item.message);
        const response = await this.httpPost(payload);

        if (response.ok) {
          logger.info('Webhook 队列消息重新发送成功', {
            sessionId: item.sessionId,
          });
        } else {
          this.pendingQueue.push({ ...item, retries: item.retries + 1 });
        }
      } catch {
        this.pendingQueue.push({ ...item, retries: item.retries + 1 });
      }
    }
  }

  private buildPayload(
    sessionId: string,
    message: UnifiedMessage
  ): Record<string, unknown> {
    return {
      platform: this.platformName,
      sessionId,
      message: {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.timestamp,
        metadata: message.metadata,
      },
      timestamp: Date.now(),
    };
  }

  private async httpPost(payload: Record<string, unknown>): Promise<Response> {
    const settings = this.config?.settings;
    const url = settings?.webhookUrl;
    if (!url) {
      throw new Error('Webhook URL not configured');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (settings?.secretToken) {
      headers['Authorization'] = `Bearer ${settings.secretToken}`;
    }

    const controller = new AbortController();
    const timeoutMs = settings?.timeoutMs ?? 10_000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
