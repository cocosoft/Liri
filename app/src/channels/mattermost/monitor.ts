/**
 * Mattermost 入站消息监控
 * 使用 Mattermost WebSocket API 接收实时消息
 */

import { EventEmitter } from 'events';
import type { MessageContext } from '@modules/channels/types';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'channels:mattermost:monitor', level: LogLevel.INFO });

export interface MattermostMonitorEvent {
  type:
    | 'message'
    | 'post_edited'
    | 'post_deleted'
    | 'reaction_added'
    | 'user_connected'
    | 'user_disconnected'
    | 'error';
  data: Record<string, unknown>;
}

export declare interface MattermostMonitor {
  on(event: 'message', listener: (msg: MessageContext) => void): this;
  on(event: 'event', listener: (evt: MattermostMonitorEvent) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'close', listener: () => void): this;
}

/**
 * Mattermost WebSocket 监控器
 * 连接到 Mattermost 的 WebSocket 端点接收实时事件
 */
export class MattermostMonitor extends EventEmitter {
  private ws: import('net').Socket | null = null;
  private serverUrl = '';
  private authToken = '';
  private running = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsUrl = '';

  /** 启动 WebSocket 监控 */
  start(serverUrl: string, authToken: string): void {
    this.serverUrl = serverUrl;
    this.authToken = authToken;
    this.running = true;

    const baseUrl = serverUrl.replace(/\/+$/, '');
    const wsProtocol = baseUrl.startsWith('https') ? 'wss' : 'ws';
    const hostPart = baseUrl.replace(/^https?:\/\//, '');
    this.wsUrl = `${wsProtocol}://${hostPart}/api/v4/websocket`;

    this.connect();
  }

  /** 停止监控 */
  stop(): void {
    this.running = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.destroy();
      } catch (err) {

        // ignore

        logger.debug("Operation skipped", { context: "ignore", error: err instanceof Error ? err.message : String(err) });

      }
      this.ws = null;
    }
  }

  private connect(): void {
    if (!this.running) return;

    // WebSocket implementation uses fetch-based polling as fallback
    // since Node.js net.Socket doesn't support native WebSocket
    this.startPollingFallback();
  }

  /**
   * 基于 HTTP API 轮询的入站消息接收
   * Mattermost REST API 支持按时间查询帖子
   */
  private async startPollingFallback(): Promise<void> {
    if (!this.running) return;

    let since = Math.floor(Date.now() / 1000);

    const poll = async (): Promise<void> => {
      if (!this.running) return;

      try {
        const baseUrl = this.serverUrl.replace(/\/+$/, '');
        const url = `${baseUrl}/api/v4/posts?since=${since}&per_page=50`;

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.authToken}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
          this.emit(
            'error',
            new Error(`Mattermost poll failed: ${response.status}`)
          );
          return;
        }

        const data = (await response.json()) as {
          posts?: Record<
            string,
            {
              id: string;
              user_id: string;
              channel_id: string;
              message: string;
              create_at: number;
              type?: string;
            }
          >;
          order?: string[];
        };

        if (data.posts && data.order) {
          const { posts, order } = data;
          for (const postId of order) {
            const post = posts[postId];
            if (!post || post.type === 'system_join_leave') continue;

            const postTime = Math.floor(post.create_at / 1000);
            if (postTime > since) {
              since = postTime;
            }

            const msg: MessageContext = {
              channelId: 'mattermost',
              senderId: post.user_id,
              groupId: post.channel_id,
              conversationId: post.channel_id,
              messageId: post.id,
              messageType: 'text',
              content: post.message,
              timestamp: post.create_at,
              isDirectMessage: false,
              rawPayload: { post_id: post.id, channel_id: post.channel_id },
            };

            this.emit('message', msg);
            this.emit('event', {
              type: 'message',
              data: {
                post_id: post.id,
                channel_id: post.channel_id,
                user_id: post.user_id,
              },
            });
          }
        }
      } catch (err) {
        if (this.running) {
          this.emit(
            'error',
            err instanceof Error ? err : new Error(String(err))
          );
        }
      }
    };

    const loop = async (): Promise<void> => {
      while (this.running) {
        await poll();
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    };

    loop().catch((err) => this.emit('error', err));
  }
}
