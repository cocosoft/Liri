import { randomUUID } from 'crypto';
import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
  MessageContext,
  IChannelInboundAdapter,
  InboundProtocol,
} from '@modules/channels/types';
import { handleError } from '@modules/error';
import { TTLCache } from '@modules/utils/cache';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'channels\matrix\MatrixChannel',
  level: LogLevel.INFO,
});

const MATRIX_META: ChannelMeta = {
  id: 'matrix',
  displayName: 'Matrix',
  vendor: 'Matrix.org',
  vendorSite: 'https://matrix.org',
  icon: '🧩',
  markdownCapable: true,
  maxMessageLength: 65536,
  supportedMessageTypes: ['text', 'image', 'file', 'markdown'],
};

const MATRIX_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: true,
  reactions: true,
  interactive: false,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: false,
};

/**
 * 消息去重（基于 eventId，5 秒窗口）
 */
class MatrixDedup {
  private cache = new TTLCache<number>(10000, 5000);

  claim(key: string): boolean {
    if (this.cache.has(key)) return false;
    this.cache.set(key, Date.now());
    return true;
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * Matrix Sync API 响应中的事件类型
 */
interface MatrixSyncEvent {
  type: string;
  sender: string;
  event_id: string;
  origin_server_ts: number;
  content: Record<string, unknown>;
  unsigned?: Record<string, unknown>;
  room_id?: string;
}

interface MatrixSyncResponse {
  next_batch?: string;
  rooms?: {
    join?: Record<
      string,
      {
        timeline?: { events?: MatrixSyncEvent[] };
        state?: { events?: MatrixSyncEvent[] };
      }
    >;
    invite?: Record<
      string,
      {
        invite_state?: { events?: MatrixSyncEvent[] };
      }
    >;
  };
}

class MatrixChannelPlugin extends BaseChannelPlugin {
  readonly id = 'matrix';
  readonly meta = MATRIX_META;
  readonly capabilities = MATRIX_CAPABILITIES;

  private homeserverUrl = '';
  private accessToken = '';
  private userId = '';
  private autoJoinRooms = false;
  private dedup = new MatrixDedup();
  private nextBatch = '';
  private syncAbortController: AbortController | null = null;

  constructor() {
    super();

    this.security = {
      ...this.security,
      dmPolicy: 'open' as const,
      maxPairingAttempts: 3,
      resolveSender: async (sender: Record<string, unknown>) => ({
        userId: (sender['userId'] as string) || 'unknown',
        displayName: (sender['displayName'] as string) || 'Unknown',
        isApproved: true,
      }),
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      homeserverUrl: '',
      accessToken: '',
      userId: '',
      autoJoinRooms: false,
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['homeserverUrl']) errors.push('缺少 homeserverUrl');
    if (!config['accessToken']) errors.push('缺少 accessToken');
    if (!config['userId']) errors.push('缺少 userId');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this.homeserverUrl = ((config['homeserverUrl'] as string) || '').replace(
      /\/$/,
      ''
    );
    this.accessToken = (config['accessToken'] as string) || '';
    this.userId = (config['userId'] as string) || '';
    this.autoJoinRooms = (config['autoJoinRooms'] as boolean) ?? false;
    this.dedup.clear();

    // 验证凭据
    const verifyResp = await fetch(
      `${this.homeserverUrl}/_matrix/client/v3/account/whoami`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } }
    );
    if (!verifyResp.ok) {
      this.logger.warn('Matrix 凭据验证失败', { status: verifyResp.status });
    } else {
      const data = (await verifyResp.json()) as Record<string, unknown>;
      this.logger.info('Matrix 通道已连接', {
        userId: data['user_id'],
        homeserver: this.homeserverUrl,
      });
    }

    // 启用 Sync API 长轮询
    if (this.inboundListening) {
      this.startSyncLoop();
    }
  }

  protected override async onDisconnect(): Promise<void> {
    this.stopSyncLoop();
  }

  /**
   * 启动 Matrix Sync API 长轮询
   */
  private startSyncLoop(): void {
    if (this.syncAbortController) return;

    this.syncAbortController = new AbortController();
    const signal = this.syncAbortController.signal;

    const poll = async (): Promise<void> => {
      while (!signal.aborted) {
        try {
          await this.syncPoll();
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') break;
          await handleError(err, {
            module: 'channels:matrix',
            action: 'syncPoll',
          });
          // 出错后等待 5 秒重试
          await this.sleep(5000);
        }
      }
    };

    poll().catch((err) => {
      this.logger.error('Matrix Sync 循环异常退出', { error: String(err) });
    });

    this.logger.info('Matrix Sync 长轮询已启动');
  }

  /**
   * 停止 Sync 长轮询
   */
  private stopSyncLoop(): void {
    if (this.syncAbortController) {
      this.syncAbortController.abort();
      this.syncAbortController = null;
      this.logger.info('Matrix Sync 长轮询已停止');
    }
  }

  /**
   * 执行一次 Sync 轮询
   */
  private async syncPoll(): Promise<void> {
    const params = new URLSearchParams({ timeout: '30000' });
    if (this.nextBatch) {
      params.set('since', this.nextBatch);
    }

    const resp = await fetch(
      `${this.homeserverUrl}/_matrix/client/v3/sync?${params}`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        signal: this.syncAbortController?.signal,
      }
    );

    if (!resp.ok) {
      this.logger.warn('Matrix Sync 请求失败', { status: resp.status });
      return;
    }

    const data = (await resp.json()) as MatrixSyncResponse;

    if (data.next_batch) {
      this.nextBatch = data.next_batch;
    }

    // 处理加入的房间
    if (data.rooms?.join) {
      for (const [roomId, roomData] of Object.entries(data.rooms.join)) {
        // 处理时间线事件
        if (roomData.timeline?.events) {
          for (const event of roomData.timeline.events) {
            this.processSyncEvent(roomId, event);
          }
        }
      }
    }

    // 处理邀请
    if (data.rooms?.invite && this.autoJoinRooms) {
      for (const [roomId] of Object.entries(data.rooms.invite)) {
        try {
          await this.joinRoom(roomId);
        } catch {
          this.logger.warn('Matrix 自动加入房间失败', { roomId });
        }
      }
    }
  }

  /**
   * 处理 Sync 事件
   */
  private processSyncEvent(roomId: string, event: MatrixSyncEvent): void {
    if (event.type !== 'm.room.message') return;

    // 跳过自己发送的消息
    if (event.sender === this.userId) return;

    const msgtype = event.content?.msgtype as string;
    if (msgtype !== 'm.text') return;

    // 去重
    if (!this.dedup.claim(event.event_id)) return;

    const body = (event.content?.body as string) || '';
    if (!body.trim()) return;

    const senderLocalpart = event.sender.includes(':')
      ? event.sender.split(':')[0]!.replace(/^@/, '')
      : event.sender;

    const ctx: MessageContext = {
      channelId: 'matrix',
      senderId: event.sender,
      senderName: senderLocalpart,
      groupId: roomId,
      conversationId: roomId,
      messageId: event.event_id,
      messageType: 'text',
      content: body,
      timestamp: event.origin_server_ts,
      isDirectMessage: false,
      rawPayload: event as unknown as Record<string, unknown>,
    };

    this.handleIncomingMessage(ctx).catch((err) => {
      this.logger.error('Matrix 消息处理异常', { error: String(err) });
    });
  }

  /**
   * 发送消息到 Matrix 房间
   */
  private async matrixPut(
    path: string,
    body: Record<string, unknown>
  ): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
    try {
      const url = `${this.homeserverUrl}${path}`;
      const resp = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(body),
      });
      const data = resp.ok
        ? ((await resp.json()) as Record<string, unknown>)
        : undefined;
      const error = resp.ok
        ? undefined
        : `Matrix API ${resp.status}: ${await resp.text()}`;
      return { ok: resp.ok, data, error };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  /**
   * 加入房间
   */
  private async joinRoom(roomId: string): Promise<void> {
    const resp = await fetch(
      `${this.homeserverUrl}/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      }
    );
    if (!resp.ok) {
      throw new Error(`Matrix 加入房间失败: ${resp.status}`);
    }
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    const txnId = randomUUID();
    const result = await this.matrixPut(
      `/_matrix/client/v3/rooms/${encodeURIComponent(target)}/send/m.room.message/${txnId}`,
      { msgtype: 'm.text', body: content }
    );
    return {
      success: result.ok,
      error: result.error,
      messageId: result.data?.['event_id'] as string,
    };
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    const txnId = randomUUID();
    const result = await this.matrixPut(
      `/_matrix/client/v3/rooms/${encodeURIComponent(target)}/send/m.room.message/${txnId}`,
      { msgtype: 'm.image', body: '图片', url: imageUrl }
    );
    return { success: result.ok, error: result.error };
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    const txnId = randomUUID();
    const fileName = filePath.split(/[/\\]/).pop() || 'file';
    const result = await this.matrixPut(
      `/_matrix/client/v3/rooms/${encodeURIComponent(target)}/send/m.room.message/${txnId}`,
      { msgtype: 'm.file', body: fileName, url: filePath }
    );
    return { success: result.ok, error: result.error };
  }

  protected override async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    const start = Date.now();
    try {
      const resp = await fetch(
        `${this.homeserverUrl}/_matrix/client/v3/account/whoami`,
        { headers: { Authorization: `Bearer ${this.accessToken}` } }
      );
      return { healthy: resp.ok, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }

  /**
   * 创建入站适配器，将 Sync 长轮询生命周期绑定到 start/stop
   */
  protected override createInboundAdapter(): IChannelInboundAdapter {
    const self = this;
    return {
      protocol: 'polling' as InboundProtocol,

      get isListening(): boolean {
        return self.inboundListening;
      },

      start: async (_config: Record<string, unknown>): Promise<void> => {
        self.logger.info('Matrix Sync 入站消息监听启动');
        self.setInboundListening(true);
        self.startSyncLoop();
      },

      stop: async (): Promise<void> => {
        self.stopSyncLoop();
        self.setInboundListening(false);
        self.logger.info('Matrix Sync 入站消息监听已停止');
      },

      setMessageHandler: (
        handler: (message: MessageContext) => Promise<void>
      ): void => {
        self.setMessageHandler(handler);
      },
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function createMatrixChannel(): IChannelPlugin {
  return new MatrixChannelPlugin();
}

export const matrixChannelPlugin = createMatrixChannel();
