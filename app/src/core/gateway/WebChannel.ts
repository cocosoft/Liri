/**
 * WebChannel — WebSocket 通道适配器（遗留版）
 * 使用 Node.js 内置 http + crypto 模块实现 RFC 6455 WebSocket 服务器
 * 无需第三方依赖
 *
 * @deprecated 请使用 channels/webhook/ 或 channels/matrix/ 等 IChannelPlugin 实现替代。
 *   core/gateway/ 体系后续将统一收敛到 channels/ 体系。
 *   此模块将在未来版本中移除。
 *
 * 接口收敛完成（2026-06-16）：
 *   - ✅ 已移除 `implements GatewayChannel`，仅保留 `ChannelPlugin`
 *   - ✅ 已移除 `initialize()` / `send()`（逻辑已内联到 `handleOutbound()` / `broadcastAll()`）
 *   - ✅ `isConnected()` / `healthCheck()` 保留为公共方法（兼容 ChannelManager 类型转换）
 *   - ✅ GatewaySetup 已改用 `channelRegistry.register(adaptPluginToChannelInterface())`
 */

import * as http from 'http';
import * as net from 'net';
import * as crypto from 'crypto';
import { randomUUID } from 'crypto';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type {
  InboundMessage,
  OutboundMessage,
  ChannelConfig,
  ChannelEventCallbacks,
  ChannelStats,
} from './types';
import { ChannelType, ChannelStatus, MessageDirection } from './types';
import type {
  ChannelPlugin,
  ChannelCapabilities,
  PluginValidationResult,
} from './ChannelPlugin';
import { handleError } from '@modules/error/handleError';
import { handleVoiceUpgrade } from '../../voice/VoiceGatewayBridge';

const logger = new Logger({ level: LogLevel.INFO, module: 'channel:websocket' });

/** WebSocket 魔术 GUID (RFC 6455) */
const MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** 语音 WebSocket 端点路径 */
const VOICE_WS_PATH = '/voice';

/** WebSocket 通道配置 */
export interface WebChannelConfig extends ChannelConfig {
  /** 监听主机 */
  host?: string;
  /** 监听端口 */
  port: number;
  /** 路径过滤 */
  path?: string;
  /** 消息大小限制（字节） */
  maxMessageSize?: number;
}

/** 已连接的 WebSocket 客户端 */
interface WebSocketClient {
  id: string;
  socket: net.Socket;
  connectedAt: number;
  label?: string;
}

/** WebSocket 操作码 */
const enum OpCode {
  CONTINUATION = 0x0,
  TEXT = 0x1,
  BINARY = 0x2,
  CLOSE = 0x8,
  PING = 0x9,
  PONG = 0xa,
}

/**
 * WebSocket 通道
 * 基于 HTTP Upgrade 机制实现 WebSocket 服务器
 */
export class WebChannel implements ChannelPlugin {
  readonly name: string;
  readonly type = ChannelType.WEBSOCKET;
  readonly config: WebChannelConfig;

  private _status: ChannelStatus = ChannelStatus.IDLE;
  private _callbacks: ChannelEventCallbacks = {};
  private server: http.Server | null = null;
  private clients: Map<string, WebSocketClient> = new Map();
  private _startTime = 0;
  private _messagesReceived = 0;
  private _messagesSent = 0;
  private _errors = 0;
  private _reconnects = 0;

  constructor(config: WebChannelConfig) {
    this.name = config.name;
    this.config = {
      host: '0.0.0.0',
      path: '/',
      maxMessageSize: 1024 * 1024,
      ...config,
    };
  }

  get status(): ChannelStatus {
    return this._status;
  }

  get stats(): ChannelStats {
    return {
      messagesReceived: this._messagesReceived,
      messagesSent: this._messagesSent,
      errors: this._errors,
      reconnects: this._reconnects,
      uptimeMs: this._startTime > 0 ? Date.now() - this._startTime : 0,
      lastActivityAt: Date.now(),
    };
  }

  async connect(): Promise<void> {
    if (
      this._status === ChannelStatus.CONNECTED ||
      this._status === ChannelStatus.CONNECTING
    ) {
      return;
    }

    this.setStatus(ChannelStatus.CONNECTING);

    try {
      this.server = http.createServer((req, res) => {
        const url = req.url ?? '/';

        if (url === VOICE_WS_PATH) {
          handleVoiceUpgrade(req, res);
          return;
        }

        if (!this.isWebSocketUpgrade(req)) {
          res.writeHead(426, { 'Content-Type': 'text/plain' });
          res.end('Upgrade Required');
          return;
        }

        this.handleUpgrade(req, res);
      });

      return new Promise((resolve, reject) => {
        this.server!.listen(this.config.port, this.config.host!, () => {
          this._startTime = Date.now();
          this.setStatus(ChannelStatus.CONNECTED);
          this._callbacks.onConnected?.();
          logger.info(
            `WebChannel: ${this.name} 已启动 — ws://${this.config.host}:${this.config.port}${this.config.path}`
          );
          resolve();
        });

        this.server!.on('error', (err) => {
          this._errors++;
          this.setStatus(ChannelStatus.ERROR);
          this._callbacks.onError?.(err);
          reject(err);
        });
      });
    } catch (error) {
      this.setStatus(ChannelStatus.ERROR);
      const err = error instanceof Error ? error : new Error(String(error));
      this._errors++;
      this._callbacks.onError?.(err);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.clients.forEach((client) => {
      try {
        this.sendCloseFrame(client.socket);
        client.socket.end();
      } catch {
        // 忽略断开时的错误
      }
    });

    this.clients.clear();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.setStatus(ChannelStatus.DISCONNECTED);
          this._callbacks.onDisconnected?.('服务器关闭');
          this.server = null;
          logger.info(`WebChannel: ${this.name} 已停止`);
          resolve();
        });
      } else {
        this.setStatus(ChannelStatus.DISCONNECTED);
        resolve();
      }
    });
  }

  setCallbacks(callbacks: ChannelEventCallbacks): void {
    this._callbacks = callbacks;
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      name: this.name,
      type: this.type,
      status: this._status,
      address: `${this.config.host}:${this.config.port}`,
      connectedClients: this.clients.size,
      uptimeMs: this._startTime > 0 ? Date.now() - this._startTime : 0,
      messagesReceived: this._messagesReceived,
      messagesSent: this._messagesSent,
      errors: this._errors,
    };
  }

  // ---- ChannelPlugin 接口实现 ----

  get id(): string {
    return this.name;
  }

  get capabilities(): ChannelCapabilities {
    return this.getCapabilities();
  }

  async handleInbound(message: InboundMessage): Promise<void> {
    this._messagesReceived++;
    this._callbacks.onMessage?.(message);
  }

  async handleOutbound(message: OutboundMessage): Promise<boolean> {
    const clientId = message.recipient;
    const client = this.clients.get(clientId);

    if (!client) {
      logger.warning(`WebChannel: 客户端 ${clientId} 不存在`);
      return false;
    }

    try {
      const payload = JSON.stringify({
        type: 'message',
        sessionId: message.sessionId,
        content: message.content,
        metadata: message.metadata,
      });

      this.sendTextFrame(client.socket, payload);
      this._messagesSent++;
      return true;
    } catch (error) {
      this._errors++;
      await handleError(error, { module: 'gateway:websocket', action: 'send_message' });
      return false;
    }
  }

  getCapabilities(): ChannelCapabilities {
    return {
      messageTypes: ['text', 'markdown'],
      supportsMedia: false,
      maxMessageLength: 0,
      directions: [MessageDirection.INBOUND, MessageDirection.OUTBOUND],
      features: ['websocket_server', 'broadcast', 'client_tracking'],
    };
  }

  validateConfig(): PluginValidationResult {
    const errors: string[] = [];
    if (!this.config.port || this.config.port <= 0) {
      errors.push('端口号无效');
    }
    if (this.config.port < 1024 && this.config.port > 0) {
      errors.push('端口号小于 1024 需要管理员权限');
    }
    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /** 获取已连接客户端列表 */
  getConnectedClients(): Array<{
    id: string;
    connectedAt: number;
    label?: string;
  }> {
    return Array.from(this.clients.values()).map((c) => ({
      id: c.id,
      connectedAt: c.connectedAt,
      label: c.label,
    }));
  }

  /** 通道连接状态（兼容 GatewayChannel 类型） */
  isConnected(): boolean {
    return this._status === ChannelStatus.CONNECTED;
  }

  /** 健康检查（兼容 GatewayChannel 类型） */
  async healthCheck(): Promise<boolean> {
    return this._status === ChannelStatus.CONNECTED;
  }

  /** 广播消息到所有客户端 */
  async broadcastAll(message: OutboundMessage): Promise<number> {
    let successCount = 0;

    for (const [clientId] of this.clients) {
      const success = await this.handleOutbound({ ...message, recipient: clientId });
      if (success) {
        successCount++;
      }
    }

    return successCount;
  }

  /** 断开指定客户端 */
  disconnectClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      try {
        this.sendCloseFrame(client.socket);
        client.socket.end();
      } catch {
        // 忽略
      }
      this.clients.delete(clientId);
    }
  }

  /**
   * 检测是否为 WebSocket 升级请求
   */
  private isWebSocketUpgrade(req: http.IncomingMessage): boolean {
    const upgrade = req.headers['upgrade']?.toLowerCase();
    return upgrade === 'websocket';
  }

  /**
   * 处理 WebSocket 升级
   */
  private handleUpgrade(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    const key = req.headers['sec-websocket-key'] as string;
    if (!key) {
      res.writeHead(400);
      res.end();
      return;
    }

    const acceptKey = this.generateAcceptKey(key);

    res.writeHead(101, {
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Sec-WebSocket-Accept': acceptKey,
    });

    const rawSocket = res.socket;
    if (!rawSocket) {
      res.end();
      return;
    }

    rawSocket.setKeepAlive(true);
    rawSocket.setTimeout(0);

    const client: WebSocketClient = {
      id: randomUUID(),
      socket: rawSocket,
      connectedAt: Date.now(),
      label: (req.headers['user-agent'] as string) || undefined,
    };

    this.clients.set(client.id, client);
    logger.info(`WebChannel: 客户端已连接 — ${client.id}`);

    this.listenForFrames(client.id, rawSocket);
  }

  /**
   * 监听 WebSocket 数据帧
   */
  private listenForFrames(clientId: string, socket: net.Socket): void {
    let buffer = Buffer.alloc(0);

    socket.on('data', (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);

      while (buffer.length >= 2) {
        const frame = this.parseFrame(buffer);
        if (!frame) {
          break;
        }

        buffer = buffer.slice(frame.totalLength);

        switch (frame.opcode) {
          case OpCode.TEXT: {
            const text = frame.payload.toString('utf-8');
            this.handleTextMessage(clientId, text);
            break;
          }

          case OpCode.CLOSE: {
            this.clients.delete(clientId);
            socket.end();
            break;
          }

          case OpCode.PING: {
            this.sendPongFrame(socket, frame.payload);
            break;
          }

          case OpCode.PONG: {
            break;
          }
        }
      }
    });

    socket.on('close', () => {
      this.clients.delete(clientId);
      logger.info(`WebChannel: 客户端已断开 — ${clientId}`);
    });

    socket.on('error', (err) => {
      this.clients.delete(clientId);
      this._errors++;
      logger.error(`WebChannel: 客户端错误 — ${clientId}`, {
        error: err.message,
      });
    });
  }

  /**
   * 处理文本消息
   */
  private async handleTextMessage(
    clientId: string,
    text: string
  ): Promise<void> {
    try {
      const parsed = JSON.parse(text);

      const messageType = parsed.type || 'message';

      if (messageType === 'ping') {
        const client = this.clients.get(clientId);
        if (client) {
          this.sendTextFrame(client.socket, JSON.stringify({ type: 'pong' }));
        }
        return;
      }

      const inboundMessage: InboundMessage = {
        id: `ws_${clientId}_${Date.now()}`,
        content: parsed.content || parsed.text || text,
        sessionId: parsed.sessionId,
        sender: clientId,
        raw: parsed,
        timestamp: Date.now(),
      };

      await this.handleInbound(inboundMessage);
    } catch {
      const inboundMessage: InboundMessage = {
        id: `ws_${clientId}_${Date.now()}`,
        content: text,
        sender: clientId,
        raw: { text },
        timestamp: Date.now(),
      };

      await this.handleInbound(inboundMessage);
    }
  }

  /**
   * 生成 WebSocket Accept Key
   */
  private generateAcceptKey(key: string): string {
    const sha1 = crypto.createHash('sha1');
    sha1.update(key + MAGIC_GUID);
    return sha1.digest('base64');
  }

  /**
   * 解析 WebSocket 帧
   */
  private parseFrame(
    buffer: Buffer
  ): { opcode: number; payload: Buffer; totalLength: number } | null {
    if (buffer.length < 2) {
      return null;
    }

    const firstByte = buffer[0];
    const secondByte = buffer[1];
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      if (buffer.length < 4) {
        return null;
      }
      payloadLength = buffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLength === 127) {
      if (buffer.length < 10) {
        return null;
      }
      const high = buffer.readUInt32BE(2);
      const low = buffer.readUInt32BE(6);
      payloadLength = high * 0x100000000 + low;
      offset = 10;
    }

    const maskSize = masked ? 4 : 0;
    const headerEnd = offset + maskSize;

    if (buffer.length < headerEnd + payloadLength) {
      return null;
    }

    let mask: Buffer | null = null;
    if (masked) {
      mask = buffer.subarray(offset, offset + 4);
    }

    let payload = buffer.subarray(headerEnd, headerEnd + payloadLength);

    if (mask) {
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= mask[i % 4];
      }
    }

    return {
      opcode,
      payload,
      totalLength: headerEnd + payloadLength,
    };
  }

  /**
   * 发送文本帧
   */
  private sendTextFrame(socket: net.Socket, text: string): void {
    const payload = Buffer.from(text, 'utf-8');
    const frame = this.buildFrame(OpCode.TEXT, payload, false);
    socket.write(frame);
  }

  /**
   * 发送关闭帧
   */
  private sendCloseFrame(socket: net.Socket): void {
    try {
      const frame = this.buildFrame(
        OpCode.CLOSE,
        Buffer.from([0x03, 0xe8]),
        false
      );
      socket.write(frame);
    } catch {
      // 忽略关闭帧发送错误
    }
  }

  /**
   * 发送 Pong 帧
   */
  private sendPongFrame(socket: net.Socket, payload: Buffer): void {
    const frame = this.buildFrame(OpCode.PONG, payload, false);
    socket.write(frame);
  }

  /**
   * 构建 WebSocket 帧
   */
  private buildFrame(opcode: number, payload: Buffer, masked: boolean): Buffer {
    let headerSize = 2;

    if (payload.length > 125 && payload.length <= 65535) {
      headerSize += 2;
    } else if (payload.length > 65535) {
      headerSize += 8;
    }

    if (masked) {
      headerSize += 4;
    }

    const frame = Buffer.alloc(headerSize + payload.length);
    frame[0] = 0x80 | opcode;

    if (payload.length <= 125) {
      frame[1] = payload.length | (masked ? 0x80 : 0);
    } else if (payload.length <= 65535) {
      frame[1] = 126 | (masked ? 0x80 : 0);
      frame.writeUInt16BE(payload.length, 2);
    } else {
      frame[1] = 127 | (masked ? 0x80 : 0);
      frame.writeUInt32BE(0, 2);
      frame.writeUInt32BE(payload.length, 6);
    }

    if (masked) {
      const mask = crypto.randomBytes(4);
      const maskOffset = headerSize - 4;
      mask.copy(frame, maskOffset);

      for (let i = 0; i < payload.length; i++) {
        frame[headerSize + i] = payload[i] ^ mask[i % 4];
      }
    } else {
      payload.copy(frame, headerSize);
    }

    return frame;
  }

  /**
   * 设置状态
   */
  private setStatus(status: ChannelStatus): void {
    const previous = this._status;
    if (previous !== status) {
      this._status = status;
      this._callbacks.onStateChange?.(status, previous);
    }
  }
}
