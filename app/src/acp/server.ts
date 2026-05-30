import type {
  AcpServerOptions,
  SessionId,
  AcpWebSocketServerConfig,
} from './types.js';
import type {
  AcpRuntime,
  AcpRuntimeHandle,
  AcpRuntimeSessionMode,
  AcpRuntimePromptMode,
} from './runtime/types.js';
import type { AcpSessionStore } from './session.js';
import { getDefaultSessionStore } from './session.js';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import * as http from 'node:http';
import * as net from 'node:net';
import type { Duplex } from 'node:stream';
import * as crypto from 'node:crypto';

const logger = new Logger({ level: LogLevel.INFO });

/** RFC 6455 WebSocket 魔术 GUID */
const MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

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
 * ACP WebSocket 远程桥接服务器
 *
 * 基于 Node.js 内置 http + crypto 模块实现 RFC 6455 WebSocket 服务器，
 * 无需第三方依赖。接受远程 ACP 客户端连接，将消息路由到 AcpRuntime。
 */
export class AcpWebSocketServer {
  readonly name = 'acp-remote-bridge';

  private httpServer: http.Server | null = null;
  private clients: Map<string, AcpWsClient> = new Map();
  private gateway: AcpGateway;
  private config: AcpWebSocketServerConfig;
  private started = false;

  constructor(
    runtime: AcpRuntime,
    config: AcpWebSocketServerConfig,
    sessionStore?: AcpSessionStore,
    options?: AcpServerOptions
  ) {
    this.gateway = new AcpGateway(
      runtime,
      sessionStore || getDefaultSessionStore(),
      options
    );
    this.config = {
      host: '127.0.0.1',
      path: '/acp',
      maxMessageSize: 1 * 1024 * 1024,
      ...config,
    };
  }

  /**
   * 启动 ACP WebSocket 服务器
   */
  async start(): Promise<void> {
    if (this.started) return;

    if (this.config.port === 0) {
      logger.info('[ACP] 远程桥接已禁用（port=0）');
      this.started = true;
      return;
    }

    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => {
        if (req.url === this.config.path) {
          res.writeHead(426, { 'Content-Type': 'text/plain' });
          res.end('This endpoint requires WebSocket connection');
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      this.httpServer.on('upgrade', (req, socket, head) => {
        const url = req.url || '';

        if (url !== this.config.path) {
          socket.destroy();
          return;
        }

        if (!this.verifyUpgradeRequest(req)) {
          socket.write(
            'HTTP/1.1 401 Unauthorized\r\n' +
              'Content-Type: text/plain\r\n' +
              'Connection: close\r\n' +
              '\r\n' +
              'Unauthorized'
          );
          socket.destroy();
          return;
        }

        this.handleUpgrade(req, socket, head);
      });

      this.httpServer.on('error', (err) => {
        logger.error('[ACP] 服务器启动失败', err);
        reject(err);
      });

      this.httpServer.listen(this.config.port, this.config.host, () => {
        const addr = this.httpServer!.address();
        const port =
          typeof addr === 'object' && addr ? addr.port : this.config.port;
        logger.info(
          `[ACP] 远程桥接 WebSocket 服务器已启动: ws://${this.config.host}:${port}${this.config.path}`
        );
        this.started = true;
        resolve();
      });
    });
  }

  /**
   * 停止 ACP WebSocket 服务器
   */
  async stop(): Promise<void> {
    if (!this.started || !this.httpServer) return;

    for (const [, client] of this.clients) {
      client.close(1001, 'Server shutting down');
    }
    this.clients.clear();

    return new Promise((resolve) => {
      this.httpServer!.close(() => {
        logger.info('[ACP] 远程桥接服务器已停止');
        this.httpServer = null;
        this.started = false;
        resolve();
      });
    });
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    if (this.config.port === 0) return true;
    return this.httpServer !== null && this.httpServer.listening;
  }

  /**
   * 获取当前已连接的客户端数量
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * 验证升级请求
   */
  private verifyUpgradeRequest(req: http.IncomingMessage): boolean {
    const upgrade = req.headers['upgrade'] || '';
    if (upgrade.toLowerCase() !== 'websocket') return false;

    if (this.config.authToken) {
      const auth = req.headers['authorization'] || '';
      if (auth !== `Bearer ${this.config.authToken}`) return false;
    }

    return true;
  }

  /**
   * 处理 WebSocket 升级握手
   */
  private handleUpgrade(
    req: http.IncomingMessage,
    socket: net.Socket | Duplex,
    head: Buffer
  ): void {
    const key = req.headers['sec-websocket-key'] as string;
    if (!key) {
      socket.destroy();
      return;
    }

    const acceptHash = crypto
      .createHash('sha1')
      .update(key + MAGIC_GUID)
      .digest('base64');

    const responseHeaders = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptHash}`,
      '',
      '',
    ].join('\r\n');

    socket.write(responseHeaders);

    if (head.length > 0) {
      socket.write(head);
    }

    const clientId = crypto.randomUUID();
    const client = new AcpWsClient(clientId, socket, () => {
      this.clients.delete(clientId);
    });
    client.setMaxMessageSize(this.config.maxMessageSize || 1 * 1024 * 1024);

    this.clients.set(clientId, client);
    logger.info(`[ACP] 客户端已连接: ${clientId} (共 ${this.clients.size} 个)`);

    this.handleClientMessages(client);
  }

  /**
   * 处理客户端消息
   */
  private async handleClientMessages(client: AcpWsClient): Promise<void> {
    const runtime = this.gateway.getRuntime();
    const sessionStore = this.gateway.getSessionStore();

    let currentHandle: AcpRuntimeHandle | null = null;

    client.onMessage(async (text) => {
      let message: AcpClientMessage;
      try {
        message = JSON.parse(text);
      } catch {
        client.send(
          JSON.stringify({
            type: 'error',
            requestId: 'unknown',
            payload: { message: '无效的 JSON 格式' },
          })
        );
        return;
      }

      const { type, requestId, payload } = message;
      const rid = requestId || crypto.randomUUID();

      if (type === 'ping') {
        client.send(
          JSON.stringify({
            type: 'pong',
            requestId: rid,
            payload: { timestamp: Date.now() },
          })
        );
        return;
      }

      if (type === 'ensure_session') {
        try {
          currentHandle = await runtime.ensureSession({
            sessionKey: (payload?.sessionKey as string) || crypto.randomUUID(),
            agent: (payload?.agent as string) || 'acp-remote-client',
            mode: (payload?.mode as AcpRuntimeSessionMode) || 'persistent',
            cwd: payload?.cwd as string | undefined,
          });
          client.send(
            JSON.stringify({
              type: 'event',
              requestId: rid,
              payload: { handle: currentHandle },
            })
          );
          client.send(
            JSON.stringify({
              type: 'done',
              requestId: rid,
              payload: { stopReason: 'success' },
            })
          );
        } catch (error) {
          client.send(
            JSON.stringify({
              type: 'error',
              requestId: rid,
              payload: {
                message: error instanceof Error ? error.message : String(error),
              },
            })
          );
        }
        return;
      }

      if (type === 'run_turn') {
        if (!currentHandle) {
          client.send(
            JSON.stringify({
              type: 'error',
              requestId: rid,
              payload: { message: '会话未建立，请先调用 ensure_session' },
            })
          );
          return;
        }

        try {
          const iterable = runtime.runTurn({
            handle: currentHandle,
            text: (payload?.text as string) || '',
            mode: (payload?.mode as AcpRuntimePromptMode) || 'prompt',
            requestId: rid,
          });

          for await (const event of iterable) {
            switch (event.type) {
              case 'text_delta':
                client.send(
                  JSON.stringify({
                    type: 'event',
                    requestId: rid,
                    payload: {
                      eventType: 'text_delta',
                      text: event.text,
                      stream: event.stream,
                      tag: event.tag,
                    },
                  })
                );
                break;
              case 'status':
                client.send(
                  JSON.stringify({
                    type: 'event',
                    requestId: rid,
                    payload: {
                      eventType: 'status',
                      text: event.text,
                      tag: event.tag,
                      used: event.used,
                      size: event.size,
                    },
                  })
                );
                break;
              case 'tool_call':
                client.send(
                  JSON.stringify({
                    type: 'event',
                    requestId: rid,
                    payload: {
                      eventType: 'tool_call',
                      text: event.text,
                      tag: event.tag,
                      toolCallId: event.toolCallId,
                      status: event.status,
                      title: event.title,
                    },
                  })
                );
                break;
              case 'error':
                client.send(
                  JSON.stringify({
                    type: 'error',
                    requestId: rid,
                    payload: {
                      message: event.message,
                      code: event.code,
                      retryable: event.retryable,
                    },
                  })
                );
                return;
            }
          }

          client.send(
            JSON.stringify({
              type: 'done',
              requestId: rid,
              payload: { stopReason: 'success' },
            })
          );
        } catch (error) {
          client.send(
            JSON.stringify({
              type: 'error',
              requestId: rid,
              payload: {
                message: error instanceof Error ? error.message : String(error),
              },
            })
          );
        }
        return;
      }

      if (type === 'cancel') {
        if (currentHandle) {
          await runtime.cancel({
            handle: currentHandle,
            reason: payload?.reason as string | undefined,
          });
        }
        client.send(
          JSON.stringify({
            type: 'done',
            requestId: rid,
            payload: { stopReason: 'cancelled' },
          })
        );
        return;
      }

      if (type === 'close') {
        if (currentHandle) {
          await runtime.close({
            handle: currentHandle,
            reason: (payload?.reason as string) || 'Client closed',
          });
          currentHandle = null;
        }
        client.send(
          JSON.stringify({
            type: 'done',
            requestId: rid,
            payload: { stopReason: 'success' },
          })
        );
        client.close(1000, 'Session closed');
        return;
      }

      client.send(
        JSON.stringify({
          type: 'error',
          requestId: rid,
          payload: { message: `未知消息类型: ${type}` },
        })
      );
    });

    client.onClose(() => {
      if (currentHandle) {
        runtime
          .close({
            handle: currentHandle,
            reason: 'Client disconnected',
          })
          .catch(() => {});
        currentHandle = null;
      }
      logger.info(
        `[ACP] 客户端已断开: ${client.id} (剩余 ${this.clients.size} 个)`
      );
    });
  }
}

/**
 * ACP 客户端消息结构
 */
interface AcpClientMessage {
  type: string;
  requestId?: string;
  payload?: Record<string, unknown>;
}

/**
 * ACP WebSocket 客户端连接包装
 */
class AcpWsClient {
  readonly id: string;
  private socket: net.Socket | Duplex;
  private onDisconnect: () => void;
  private messageHandlers: Array<(text: string) => void> = [];
  private maxMessageSize: number;

  constructor(
    id: string,
    socket: net.Socket | Duplex,
    onDisconnect: () => void
  ) {
    this.id = id;
    this.socket = socket;
    this.onDisconnect = onDisconnect;
    this.maxMessageSize = 1 * 1024 * 1024;

    let buffer = Buffer.alloc(0);

    this.socket.on('data', (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);
      this.processFrames(buffer, (remaining: Buffer) => {
        buffer = Buffer.from(remaining);
      });
    });

    this.socket.on('close', () => {
      this.onDisconnect();
    });

    this.socket.on('error', (err: Error) => {
      logger.warning(`[ACP] 客户端异常: ${this.id}`, err);
    });
  }

  /**
   * 设置最大消息大小（字节）
   */
  setMaxMessageSize(size: number): void {
    this.maxMessageSize = size;
  }

  /**
   * 注册消息处理器
   */
  onMessage(handler: (text: string) => void): void {
    this.messageHandlers.push(handler);
  }

  /**
   * 注册断开处理器
   */
  onClose(handler: () => void): void {
    this.socket.on('close', () => {
      handler();
    });
  }

  /**
   * 发送文本消息（WebSocket 帧编码）
   */
  send(text: string): void {
    if (this.socket.destroyed) return;

    const payload = Buffer.from(text, 'utf-8');
    const frame = this.encodeFrame(OpCode.TEXT, payload);

    try {
      this.socket.write(frame);
    } catch {
      this.socket.destroy();
    }
  }

  /**
   * 关闭连接
   */
  close(code?: number, reason?: string): void {
    if (this.socket.destroyed) return;

    const closePayload = Buffer.alloc(
      2 + (reason ? Buffer.byteLength(reason, 'utf-8') : 0)
    );
    closePayload.writeUInt16BE(code || 1000, 0);
    if (reason) {
      closePayload.write(reason, 2, 'utf-8');
    }

    try {
      this.socket.write(this.encodeFrame(OpCode.CLOSE, closePayload));
    } catch {
      // 忽略关闭时的写入错误
    }

    this.socket.end();
    this.socket.destroy();
  }

  /**
   * 解析 WebSocket 帧
   */
  private processFrames(
    buffer: Buffer,
    onRemaining: (remaining: Buffer) => void
  ): void {
    let offset = 0;

    while (offset < buffer.length) {
      if (buffer.length - offset < 2) break;

      const firstByte = buffer[offset];
      const secondByte = buffer[offset + 1];
      const opcode = firstByte & 0x0f;
      const masked = (secondByte & 0x80) !== 0;
      let payloadLength = secondByte & 0x7f;
      let headerLength = 2;

      if (payloadLength === 126) {
        headerLength += 2;
        if (buffer.length - offset < headerLength) break;
        payloadLength = buffer.readUInt16BE(offset + 2);
      } else if (payloadLength === 127) {
        headerLength += 8;
        if (buffer.length - offset < headerLength) break;
        const bigLen = buffer.readBigUInt64BE(offset + 2);
        if (bigLen > BigInt(this.maxMessageSize)) {
          this.close(1009, 'Message too large');
          return;
        }
        payloadLength = Number(bigLen);
      }

      if (payloadLength > this.maxMessageSize) {
        this.close(1009, 'Message too large');
        return;
      }

      const maskLength = masked ? 4 : 0;
      const totalLength = headerLength + maskLength + payloadLength;

      if (buffer.length - offset < totalLength) break;

      let maskKey: Buffer | null = null;
      let payloadOffset = offset + headerLength;

      if (masked) {
        maskKey = buffer.subarray(payloadOffset, payloadOffset + 4);
        payloadOffset += 4;
      }

      let payload = buffer.subarray(
        payloadOffset,
        payloadOffset + payloadLength
      );

      if (maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] = payload[i] ^ maskKey[i % 4];
        }
      }

      if (opcode === OpCode.TEXT) {
        const text = payload.toString('utf-8');
        for (const handler of this.messageHandlers) {
          handler(text);
        }
      } else if (opcode === OpCode.CLOSE) {
        this.socket.end();
        this.socket.destroy();
        return;
      } else if (opcode === OpCode.PING) {
        this.socket.write(this.encodeFrame(OpCode.PONG, payload));
      }

      offset += totalLength;
    }

    onRemaining(buffer.subarray(offset));
  }

  /**
   * 编码 WebSocket 帧（服务端→客户端，不掩码）
   */
  private encodeFrame(opcode: number, payload: Buffer): Buffer {
    let header: Buffer;

    if (payload.length < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = payload.length;
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }

    return Buffer.concat([header, payload]);
  }
}

export interface AgentSideConnection {
  send(event: string, data: unknown): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  close(): void;
}

export interface GatewayClient {
  id: string;
  connectedAt: number;
  sessionId?: SessionId;
  connection: AgentSideConnection;
}

export class AcpGateway {
  private clients: Map<string, GatewayClient> = new Map();
  private runtime: AcpRuntime;
  private sessionStore: AcpSessionStore;
  private options: AcpServerOptions;

  constructor(
    runtime: AcpRuntime,
    sessionStore: AcpSessionStore,
    options: AcpServerOptions = {}
  ) {
    this.runtime = runtime;
    this.sessionStore = sessionStore;
    this.options = options;
  }

  getClient(clientId: string): GatewayClient | undefined {
    return this.clients.get(clientId);
  }

  listClients(): GatewayClient[] {
    return Array.from(this.clients.values());
  }

  registerClient(client: GatewayClient): void {
    this.clients.set(client.id, client);
  }

  unregisterClient(clientId: string): boolean {
    return this.clients.delete(clientId);
  }

  getRuntime(): AcpRuntime {
    return this.runtime;
  }

  getSessionStore(): AcpSessionStore {
    return this.sessionStore;
  }

  getOptions(): AcpServerOptions {
    return this.options;
  }
}

export function createAcpGateway(
  runtime: AcpRuntime,
  sessionStore: AcpSessionStore,
  options?: AcpServerOptions
): AcpGateway {
  return new AcpGateway(runtime, sessionStore, options);
}

/**
 * 创建 ACP WebSocket 远程桥接服务器
 */
export function createAcpWebSocketServer(
  runtime: AcpRuntime,
  config: AcpWebSocketServerConfig,
  sessionStore?: AcpSessionStore,
  options?: AcpServerOptions
): AcpWebSocketServer {
  return new AcpWebSocketServer(runtime, config, sessionStore, options);
}
