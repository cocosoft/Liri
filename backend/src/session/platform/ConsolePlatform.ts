/**
 * ConsolePlatform — 控制台平台适配器
 *
 * 将消息输出到 stdio，用于 CLI/REPL 模式。
 * 是最简平台实现，作为其他平台适配器的参考。
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type {
  PlatformAdapter,
  PlatformConfig,
  PlatformMessage,
  PlatformSendResult,
  PlatformConnectionStatus,
  PlatformType,
} from './PlatformAdapter';
import type { UnifiedMessage } from '../types/Message';

const logger = new Logger({ level: LogLevel.INFO });

export class ConsolePlatform implements PlatformAdapter {
  readonly platformName: string;
  readonly platformType: PlatformType = 'console';

  private config: PlatformConfig | null = null;
  private connected = false;
  private connectedAt = 0;
  private messageHandlers: Array<(msg: PlatformMessage) => void> = [];
  private retryCount = 0;

  constructor(name = 'console') {
    this.platformName = name;
  }

  async connect(config: PlatformConfig): Promise<void> {
    this.config = config;
    this.connected = true;
    this.connectedAt = Date.now();
    this.retryCount = 0;

    logger.info('控制台平台已连接', { name: this.platformName });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.messageHandlers = [];
    logger.info('控制台平台已断开', { name: this.platformName });
  }

  async sendMessage(
    sessionId: string,
    message: UnifiedMessage
  ): Promise<PlatformSendResult> {
    const timestamp = Date.now();

    const output = [
      `[${this.platformName}:${sessionId}]`,
      `[${message.role}]`,
      typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content),
    ].join(' ');

    if (message.role === 'assistant' || message.role === 'system') {
      process.stdout.write(output + '\n');
    } else {
      process.stderr.write(output + '\n');
    }

    logger.info('控制台消息已发送', {
      sessionId,
      role: message.role,
      contentLength:
        typeof message.content === 'string' ? message.content.length : 0,
    });

    return {
      success: true,
      platformMessageId: `console-${timestamp}`,
      sentAt: timestamp,
    };
  }

  async sendBatch(
    sessionId: string,
    messages: UnifiedMessage[]
  ): Promise<PlatformSendResult[]> {
    return Promise.all(messages.map((msg) => this.sendMessage(sessionId, msg)));
  }

  onMessage(handler: (msg: PlatformMessage) => void): () => void {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
    };
  }

  getConnectionStatus(): PlatformConnectionStatus {
    return {
      connected: this.connected,
      platform: this.platformType,
      name: this.platformName,
      connectedAt: this.connectedAt || undefined,
      retryCount: this.retryCount,
    };
  }

  isConnected(): boolean {
    return this.connected;
  }
}
