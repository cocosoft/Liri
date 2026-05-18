import * as http from 'node:http';
import * as net from 'node:net';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { getRedactMiddleware } from '../../security/redact/RedactMiddleware';
import type { GatewayAuth, AuthResult } from './auth/GatewayAuth';
import type { RateLimiter, RateLimitResult } from './RateLimiter';
import type { GatewayFrame } from './protocol/types';
import {
  createResponseFrame,
  createErrorFrame,
  createEventFrame,
  isRequestFrame,
  isInboundFrame,
  computeWebSocketAcceptKey,
} from './protocol/frames';
import { handleVoiceUpgrade } from '@modules/voice/VoiceGatewayBridge';

const rawLogger = new Logger({ level: LogLevel.INFO });

class RedactedLogger {
  info(msg: string, meta?: Record<string, unknown>) {
    rawLogger.info(getRedactMiddleware().redactMessage(msg), meta);
  }
  warning(msg: string, meta?: Record<string, unknown>) {
    rawLogger.warning(getRedactMiddleware().redactMessage(msg), meta);
  }
  error(msg: string, meta?: Record<string, unknown>) {
    rawLogger.error(msg, meta);
  }
  debug(msg: string, meta?: Record<string, unknown>) {
    rawLogger.debug(getRedactMiddleware().redactMessage(msg), meta);
  }
}

const logger = new RedactedLogger() as unknown as Logger;

export interface GatewayServerConfig {
  host?: string;
  port: number;
  path?: string;
  maxMessageSize?: number;
  maxConnections?: number;
  idleTimeoutMs?: number;
}

export interface GatewayClient {
  id: string;
  socket: net.Socket;
  connectedAt: number;
  userId?: string;
  sessionId?: string;
  role?: string;
  lastActivityAt: number;
  metadata?: Record<string, unknown>;
}

export interface GatewayStats {
  connectionsTotal: number;
  connectionsActive: number;
  connectionsPeak: number;
  messagesReceived: number;
  messagesSent: number;
  errors: number;
  authSuccess: number;
  authFailure: number;
  rateLimitBlocks: number;
  startedAt: number;
}

export enum GatewayEvent {
  CLIENT_CONNECTED = 'gateway:client_connected',
  CLIENT_DISCONNECTED = 'gateway:client_disconnected',
  MESSAGE_RECEIVED = 'gateway:message_received',
  MESSAGE_SENT = 'gateway:message_sent',
  AUTH_SUCCESS = 'gateway:auth_success',
  AUTH_FAILURE = 'gateway:auth_failure',
  ERROR = 'gateway:error',
  RATE_LIMITED = 'gateway:rate_limited',
}

const OpCode = {
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
} as const;

export class GatewayServer extends EventEmitter {
  readonly name = 'GatewayServer';
  private config: Required<GatewayServerConfig>;
  private httpServer: http.Server | null = null;
  private clients: Map<string, GatewayClient> = new Map();
  private auth: GatewayAuth | null = null;
  private rateLimiter: RateLimiter | null = null;
  private _startedAt = 0;
  private _messagesReceived = 0;
  private _messagesSent = 0;
  private _errors = 0;
  private _authSuccess = 0;
  private _authFailure = 0;
  private _rateLimitBlocks = 0;
  private _connectionsPeak = 0;

  constructor(config: GatewayServerConfig) {
    super();
    this.config = {
      host: config.host ?? '0.0.0.0',
      port: config.port,
      path: config.path ?? '/',
      maxMessageSize: config.maxMessageSize ?? 1024 * 1024,
      maxConnections: config.maxConnections ?? 1000,
      idleTimeoutMs: config.idleTimeoutMs ?? 300_000,
    };
  }

  setAuth(auth: GatewayAuth): void {
    this.auth = auth;
  }

  setRateLimiter(rateLimiter: RateLimiter): void {
    this.rateLimiter = rateLimiter;
    this.rateLimiter.setConfig('gateway:global', {
      windowMs: 60_000,
      maxRequests: 120,
    });
    this.rateLimiter.setConfig('gateway:connection', {
      windowMs: 60_000,
      maxRequests: 10,
      burstMax: 15,
      burstWindowMs: 1_000,
    });
  }

  get stats(): GatewayStats {
    return {
      connectionsTotal: this._connectionsPeak + this.clients.size,
      connectionsActive: this.clients.size,
      connectionsPeak: this._connectionsPeak,
      messagesReceived: this._messagesReceived,
      messagesSent: this._messagesSent,
      errors: this._errors,
      authSuccess: this._authSuccess,
      authFailure: this._authFailure,
      rateLimitBlocks: this._rateLimitBlocks,
      startedAt: this._startedAt,
    };
  }

  get isRunning(): boolean {
    return this.httpServer !== null;
  }

  async start(): Promise<void> {
    if (this.httpServer) {
      logger.warning('GatewayServer: 已在运行中');
      return;
    }

    this.httpServer = http.createServer((req, res) => {
      // /voice 端点路由到语音子系统
      if (req.url?.startsWith('/voice')) {
        handleVoiceUpgrade(req, res);
        return;
      }

      if (!this.isWebSocketUpgrade(req)) {
        res.writeHead(426, { 'Content-Type': 'text/plain' });
        res.end('WebSocket Upgrade Required');
        return;
      }
      this.handleUpgrade(req, res);
    });

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(this.config.port, this.config.host, () => {
        this._startedAt = Date.now();
        logger.info(
          `GatewayServer: 已启动 — ws://${this.config.host}:${this.config.port}${this.config.path}`
        );
        resolve();
      });

      this.httpServer!.on('error', (err) => {
        this._errors++;
        logger.error('GatewayServer: 启动失败', { error: err.message });
        reject(err);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.httpServer) return;

    for (const [id] of this.clients) {
      this.disconnectClient(id, '服务器关闭');
    }

    return new Promise((resolve) => {
      this.httpServer!.close(() => {
        this.httpServer = null;
        logger.info('GatewayServer: 已停止');
        resolve();
      });
    });
  }

  getClient(clientId: string): GatewayClient | undefined {
    return this.clients.get(clientId);
  }

  listClients(): GatewayClient[] {
    return Array.from(this.clients.values());
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getClientsByUser(userId: string): GatewayClient[] {
    return this.listClients().filter((c) => c.userId === userId);
  }

  disconnectClient(clientId: string, reason?: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      this.sendFrame(
        client,
        createErrorFrame('INTERNAL_ERROR', reason ?? '服务器断开连接')
      );
      client.socket.end();
    } catch {}
    this.removeClient(clientId);
  }

  disconnectUser(userId: string, reason?: string): void {
    for (const client of this.getClientsByUser(userId)) {
      this.disconnectClient(client.id, reason);
    }
  }

  async broadcast(event: string, data?: unknown): Promise<number> {
    let count = 0;
    const frame = createEventFrame(event, data);
    const message = JSON.stringify(frame);

    for (const [, client] of this.clients) {
      try {
        this.sendRaw(client.socket, message);
        count++;
      } catch {}
    }

    this._messagesSent += count;
    return count;
  }

  async sendToClient(
    clientId: string,
    event: string,
    data?: unknown
  ): Promise<boolean> {
    const client = this.clients.get(clientId);
    if (!client) return false;

    try {
      const frame = createEventFrame(event, data);
      this.sendRaw(client.socket, JSON.stringify(frame));
      this._messagesSent++;
      this.emit(GatewayEvent.MESSAGE_SENT, { clientId, event });
      return true;
    } catch (error) {
      logger.error(`GatewayServer: 发送消息失败 — ${clientId}`, {
        error: String(error),
      });
      return false;
    }
  }

  private isWebSocketUpgrade(req: http.IncomingMessage): boolean {
    const upgrade = req.headers['upgrade']?.toLowerCase() ?? '';
    return upgrade === 'websocket';
  }

  private handleUpgrade(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    const clientIp = req.socket.remoteAddress ?? 'unknown';
    const rateCheck = this.checkRateLimit(clientIp, 'connection');
    if (!rateCheck.allowed) {
      this._rateLimitBlocks++;
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: '连接请求过于频繁',
          retryAfterMs: rateCheck.retryAfterMs,
        })
      );
      this.emit(GatewayEvent.RATE_LIMITED, {
        clientIp,
        reason: '连接频率限制',
      });
      return;
    }

    if (this.clients.size >= this.config.maxConnections) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '服务器连接数已达上限' }));
      return;
    }

    const key = req.headers['sec-websocket-key'] ?? '';
    const acceptKey = computeWebSocketAcceptKey(key as string);

    const token = this.extractToken(req);

    const performUpgrade = (authResult?: AuthResult) => {
      res.writeHead(101, {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Accept': acceptKey,
      });

      const socket = req.socket;
      socket.setTimeout(this.config.idleTimeoutMs);
      socket.setNoDelay(true);

      const client: GatewayClient = {
        id: randomUUID(),
        socket,
        connectedAt: Date.now(),
        userId: authResult?.userId,
        sessionId: authResult?.sessionId,
        role: authResult?.role,
        lastActivityAt: Date.now(),
        metadata: authResult?.metadata,
      };

      this.clients.set(client.id, client);
      this._connectionsPeak = Math.max(
        this._connectionsPeak,
        this.clients.size
      );

      this.emit(GatewayEvent.CLIENT_CONNECTED, { ...client });
      logger.info(
        `GatewayServer: 客户端已连接 — ${client.id} (${clientIp})${client.userId ? ` 用户: ${client.userId}` : ''}`
      );

      this.attachSocketHandlers(socket, client);
    };

    if (token && this.auth) {
      this.auth
        .authenticate({ token })
        .then((result) => {
          if (result.authenticated) {
            this._authSuccess++;
            this.emit(GatewayEvent.AUTH_SUCCESS, {
              clientIp,
              userId: result.userId,
            });
            performUpgrade(result);
          } else {
            this._authFailure++;
            this.emit(GatewayEvent.AUTH_FAILURE, {
              clientIp,
              reason: result.reason,
            });
            performUpgrade();
          }
        })
        .catch(() => {
          performUpgrade();
        });
    } else {
      performUpgrade();
    }
  }

  private attachSocketHandlers(
    socket: net.Socket,
    client: GatewayClient
  ): void {
    const bufRef: { value: Buffer } = { value: Buffer.alloc(0) };

    socket.on('data', (data: Buffer) => {
      bufRef.value = Buffer.concat([bufRef.value, data]);
      this.processBuffer(socket, client, bufRef);
    });

    socket.on('close', () => {
      this.removeClient(client.id);
      this.emit(GatewayEvent.CLIENT_DISCONNECTED, {
        id: client.id,
        userId: client.userId,
      });
    });

    socket.on('error', (err) => {
      this._errors++;
      logger.error(`GatewayServer: 套接字错误 — ${client.id}`, {
        error: err.message,
      });
      this.removeClient(client.id);
      this.emit(GatewayEvent.ERROR, {
        clientId: client.id,
        error: err.message,
      });
    });

    socket.on('timeout', () => {
      logger.warning(`GatewayServer: 客户端超时 — ${client.id}`);
      this.disconnectClient(client.id, '连接超时');
    });
  }

  private processBuffer(
    socket: net.Socket,
    client: GatewayClient,
    bufRef: { value: Buffer }
  ): void {
    const { value: buffer } = bufRef;

    while (true) {
      if (buffer.length < 2) break;

      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let payloadLength = buffer[1] & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        if (buffer.length < 4) break;
        payloadLength = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (buffer.length < 10) break;
        payloadLength = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      if (buffer.length < offset + (masked ? 4 : 0) + payloadLength) break;

      let mask: Buffer | undefined;
      if (masked) {
        mask = buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      const payload = buffer.subarray(offset, offset + payloadLength);

      if (opcode === OpCode.TEXT || opcode === OpCode.BINARY) {
        let decoded: Buffer;
        if (masked && mask) {
          decoded = Buffer.alloc(payloadLength);
          for (let i = 0; i < payloadLength; i++) {
            decoded[i] = payload[i] ^ mask[i % 4];
          }
        } else {
          decoded = payload;
        }

        this.handleMessage(client, decoded);
      } else if (opcode === OpCode.PING) {
        this.sendRaw(socket, Buffer.from([0x8a, 0x00]));
      } else if (opcode === OpCode.CLOSE) {
        this.sendRaw(socket, Buffer.from([0x88, 0x00]));
        socket.end();
        return;
      }

      bufRef.value = buffer.subarray(offset + payloadLength);
    }
  }

  private handleMessage(client: GatewayClient, data: Buffer): void {
    client.lastActivityAt = Date.now();

    this._messagesReceived++;
    const rateCheck = this.checkRateLimit(client.id, 'global');
    if (!rateCheck.allowed) {
      this._rateLimitBlocks++;
      this.emit(GatewayEvent.RATE_LIMITED, {
        clientId: client.id,
        reason: '消息频率限制',
      });
      this.sendFrame(
        client,
        createErrorFrame('RATE_LIMITED', '请求过于频繁', {
          retryAfterMs: rateCheck.retryAfterMs,
        })
      );
      return;
    }

    let frame: GatewayFrame;
    try {
      const text = data.toString('utf-8');
      frame = JSON.parse(text) as GatewayFrame;
    } catch {
      this.sendFrame(
        client,
        createErrorFrame('INVALID_FRAME', '无效的 JSON 格式')
      );
      return;
    }

    if (!isInboundFrame(frame)) {
      this.sendFrame(
        client,
        createErrorFrame('INVALID_FRAME', '不支持的帧类型')
      );
      return;
    }

    this.emit(GatewayEvent.MESSAGE_RECEIVED, { client, frame });

    if (isRequestFrame(frame)) {
      const response = createResponseFrame(frame.id, {
        received: true,
        echo: frame.params,
      });
      this.sendFrame(client, response);
    }
  }

  private removeClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  private sendFrame(client: GatewayClient, frame: GatewayFrame): void {
    try {
      this.sendRaw(client.socket, JSON.stringify(frame));
      this._messagesSent++;
    } catch {}
  }

  private sendRaw(socket: net.Socket, data: string | Buffer): void {
    const payload =
      typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
    const length = payload.length;
    const header = Buffer.alloc(length < 126 ? 2 : length < 65536 ? 4 : 10);
    header[0] = 0x81;

    if (length < 126) {
      header[1] = length;
      socket.write(Buffer.concat([header, payload]));
    } else if (length < 65536) {
      header[1] = 126;
      header.writeUInt16BE(length, 2);
      socket.write(Buffer.concat([header, payload]));
    } else {
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
      socket.write(Buffer.concat([header, payload]));
    }
  }

  private extractToken(req: http.IncomingMessage): string | undefined {
    const auth = req.headers['authorization'];
    if (auth && typeof auth === 'string') {
      const parts = auth.split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        return parts[1];
      }
    }
    const queryToken = this.extractQueryParam(req.url, 'token');
    if (queryToken) return queryToken;
    return undefined;
  }

  private extractQueryParam(
    url: string | undefined,
    param: string
  ): string | undefined {
    if (!url) return undefined;
    const idx = url.indexOf(`${param}=`);
    if (idx === -1) return undefined;
    const start = idx + param.length + 1;
    const end = url.indexOf('&', start);
    return decodeURIComponent(
      end === -1 ? url.slice(start) : url.slice(start, end)
    );
  }

  private checkRateLimit(
    key: string,
    type: 'global' | 'connection'
  ): RateLimitResult {
    if (!this.rateLimiter)
      return {
        allowed: true,
        remaining: 999,
        resetMs: 0,
        retryAfterMs: 0,
        totalLimit: 999,
      };

    if (type === 'global') {
      const globalResult = this.rateLimiter.checkGlobal(key);
      if (!globalResult.allowed) return globalResult;
      return this.rateLimiter.check(key);
    }

    return this.rateLimiter.check(key);
  }
}
