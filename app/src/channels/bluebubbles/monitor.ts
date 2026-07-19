/**
 * BlueBubbles 入站消息监控
 * 使用 BlueBubbles REST API 轮询接收 iMessage
 */

import { EventEmitter } from 'events';
import type { MessageContext } from '@modules/channels/types';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'channels:bluebubbles:monitor',
  level: LogLevel.INFO,
});

export declare interface BlueBubblesMonitor {
  on(event: 'message', listener: (msg: MessageContext) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'close', listener: () => void): this;
}

const POLL_INTERVAL_MS = 8000;

/**
 * BlueBubbles 入站消息监控
 * 通过 BlueBubbles Server HTTP API 轮询 iMessage 新消息
 */
export class BlueBubblesMonitor extends EventEmitter {
  private serverUrl = '';
  private password = '';
  private running = false;
  private lastMessageTime = '';

  /** 启动消息轮询 */
  start(serverUrl: string, password: string): void {
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    this.password = password;
    this.running = true;

    this.pollLoop().catch((err) => this.emit('error', err));
  }

  /** 停止监控 */
  stop(): void {
    this.running = false;
  }

  /**
   * 执行一次消息轮询
   * BlueBubbles API: GET /api/v1/chat/message?limit=25
   */
  private async pollOnce(): Promise<void> {
    try {
      const response = await fetch(
        `${this.serverUrl}/api/v1/chat/message?limit=25&after=${this.lastMessageTime}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            password: this.password,
          },
          signal: AbortSignal.timeout(15000),
        }
      );

      if (!response.ok) {
        if (response.status !== 404) {
          this.emit(
            'error',
            new Error(`BlueBubbles poll failed: ${response.status}`)
          );
        }
        return;
      }

      const data = (await response.json()) as {
        status?: number;
        data?: Array<{
          guid: string;
          text?: string;
          handle?: { id: string };
          chatGuid?: string;
          dateCreated?: number;
          isFromMe?: boolean;
          associatedMessageGuid?: string;
        }>;
      };

      if (!data.data || data.data.length === 0) return;

      for (const msg of data.data) {
        if (msg.isFromMe) continue;
        if (!msg.text) continue;

        if (msg.guid) {
          this.lastMessageTime = msg.guid;
        }

        const message: MessageContext = {
          channelId: 'bluebubbles',
          senderId: msg.handle?.id || 'unknown',
          groupId: msg.chatGuid,
          conversationId: msg.chatGuid || msg.handle?.id,
          messageId: msg.guid,
          messageType: 'text',
          content: msg.text,
          timestamp: msg.dateCreated || Date.now(),
          isDirectMessage: !msg.chatGuid || !msg.chatGuid.includes(';+;'),
          rawPayload: {
            guid: msg.guid,
            chatGuid: msg.chatGuid,
            handleId: msg.handle?.id,
          },
        };

        this.emit('message', message);
      }
    } catch (err) {
      if (this.running) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      await this.pollOnce();
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}
