/**
 * AcpServer ACP 协议服务端
 * 对标 OpenClaw 的 Agent 通信协议
 */
import type { AcpMessage, AcpSession, AcpServerConfig, AcpHandler } from './index.js';
import { EventEmitter } from 'node:events';

/**
 * ACP 服务端
 */
export class AcpServer extends EventEmitter {
  private sessions: Map<string, AcpSession> = new Map();
  private handlers: Map<string, AcpHandler> = new Map();
  private config: AcpServerConfig;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: AcpServerConfig) {
    super();
    this.config = {
      serverId: config.serverId,
      maxSessions: config.maxSessions || 100,
      messageTimeout: config.messageTimeout || 30000,
      pingInterval: config.pingInterval || 15000,
    };
  }

  /**
   * 启动服务
   */
  start(): void {
    this.pingTimer = setInterval(() => {
      this.checkSessions();
    }, this.config.pingInterval);

    this.emit('started', { serverId: this.config.serverId });
  }

  /**
   * 停止服务
   */
  stop(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    for (const [id] of this.sessions) {
      this.disconnectSession(id);
    }

    this.emit('stopped', { serverId: this.config.serverId });
  }

  /**
   * 注册消息处理器
   */
  registerHandler(method: string, handler: AcpHandler): void {
    this.handlers.set(method, handler);
  }

  /**
   * 建立连接
   */
  connectSession(clientId: string, metadata?: Record<string, unknown>): AcpSession {
    if (this.sessions.size >= this.config.maxSessions!) {
      throw new Error(`达到最大会话数: ${this.config.maxSessions!}`);
    }

    const session: AcpSession = {
      id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      clientId,
      serverId: this.config.serverId,
      state: 'connected',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      metadata,
    };

    this.sessions.set(session.id, session);
    this.emit('session:connected', session);

    return session;
  }

  /**
   * 断开连接
   */
  disconnectSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);

    if (session) {
      session.state = 'disconnected';
      this.sessions.delete(sessionId);
      this.emit('session:disconnected', session);
    }
  }

  /**
   * 处理消息
   */
  async handleMessage(message: AcpMessage): Promise<AcpMessage> {
    const session = Array.from(this.sessions.values())
      .find((s) => s.clientId === message.source || s.id === message.source);

    if (!session) {
      return {
        id: `resp_${Date.now()}`,
        type: 'error',
        source: this.config.serverId,
        target: message.source,
        priority: 'normal',
        timestamp: Date.now(),
        payload: { error: '未找到会话' },
      };
    }

    session.lastActivity = Date.now();

    if (message.type === 'ping') {
      return {
        id: `resp_${Date.now()}`,
        type: 'pong',
        source: this.config.serverId,
        target: message.source,
        priority: 'low',
        timestamp: Date.now(),
        correlationId: message.id,
      };
    }

    if (message.method && this.handlers.has(message.method)) {
      const handler = this.handlers.get(message.method)!;

      try {
        const result = await handler(message);

        return {
          id: `resp_${Date.now()}`,
          type: 'response',
          source: this.config.serverId,
          target: message.source,
          priority: message.priority,
          timestamp: Date.now(),
          correlationId: message.id,
          payload: result.payload,
        };
      } catch (err) {
        return {
          id: `resp_${Date.now()}`,
          type: 'error',
          source: this.config.serverId,
          target: message.source,
          priority: message.priority,
          timestamp: Date.now(),
          correlationId: message.id,
          payload: { error: err instanceof Error ? err.message : String(err) },
        };
      }
    }

    return {
      id: `resp_${Date.now()}`,
      type: 'error',
      source: this.config.serverId,
      target: message.source,
      priority: message.priority,
      timestamp: Date.now(),
      correlationId: message.id,
      payload: { error: `未找到方法: ${message.method}` },
    };
  }

  /**
   * 获取会话列表
   */
  listSessions(): AcpSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * 获取会话数
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * 检查会话健康状态
   */
  private checkSessions(): void {
    const now = Date.now();
    const timeout = this.config.messageTimeout;

    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActivity > timeout!) {
        this.disconnectSession(id);
        this.emit('session:timeout', session);
      }
    }
  }
}
