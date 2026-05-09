/**
 * MCP会话和连接管理系统（基于CC源码实现）
 * 负责MCP连接的创建、管理、重连、会话跟踪和生命周期管理
 */

import { EventEmitter } from 'events';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type {
  MCPClient,
  MCPClientState,
  MCPServerConfig,
  ScopedMcpServerConfig,
  MCPConnectionConfig,
  MCPConnectionStats,
  MCPEventType,
} from '../types/MCPTypes';
import { MCPClientImpl } from '../client/MCPClient';
import { globalMCPToolManager } from '../management/MCPToolManager';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * MCP连接状态（基于CC源码）
 */
export interface MCPConnectionStatus {
  /** 连接状态 */
  state: MCPClientState;

  /** 连接统计 */
  stats: MCPConnectionStats;

  /** 最后活动时间 */
  lastActivity: Date;

  /** 连接错误 */
  error?: string;

  /** 重试次数 */
  retryCount: number;

  /** 是否启用自动重连 */
  autoReconnect: boolean;
}

/**
 * MCP连接信息（基于CC源码）
 */
export interface MCPConnectionInfo {
  /** 服务器名称 */
  name: string;

  /** 服务器配置 */
  config: ScopedMcpServerConfig;

  /** 连接状态 */
  status: MCPConnectionStatus;

  /** MCP客户端实例 */
  client?: MCPClient;

  /** 连接开始时间 */
  connectedAt?: Date;

  /** 连接结束时间 */
  disconnectedAt?: Date;
}

/**
 * MCP会话信息（基于CC源码）
 */
export interface MCPSessionInfo {
  /** 会话ID */
  id: string;

  /** 会话开始时间 */
  startedAt: Date;

  /** 会话结束时间 */
  endedAt?: Date;

  /** 连接的服务器 */
  connectedServers: string[];

  /** 会话统计 */
  stats: {
    totalToolCalls: number;
    totalResourceReads: number;
    totalPromptGets: number;
    totalErrors: number;
    totalDuration: number;
  };
}

/**
 * MCP连接管理器类（基于CC源码实现）
 */
export class MCPConnectionManager extends EventEmitter {
  private connections = new Map<string, MCPConnectionInfo>();
  private sessions = new Map<string, MCPSessionInfo>();
  private currentSessionId?: string;
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private maxRetries = 3;
  private retryInterval = 5000; // 5秒

  /**
   * 创建连接（基于CC源码）
   */
  async createConnection(
    name: string,
    config: ScopedMcpServerConfig,
    connectionConfig?: MCPConnectionConfig
  ): Promise<MCPClient> {
    if (this.connections.has(name)) {
      throw new Error(`Connection already exists: ${name}`);
    }

    // 创建连接信息
    const connectionInfo: MCPConnectionInfo = {
      name,
      config,
      status: {
        state: 'disconnected',
        stats: this.createInitialStats(),
        lastActivity: new Date(),
        retryCount: 0,
        autoReconnect: connectionConfig?.autoReconnect ?? true,
      },
    };

    this.connections.set(name, connectionInfo);

    // 创建客户端实例
    const client = await this.createClient(name, config, connectionConfig);
    connectionInfo.client = client;

    // 设置事件监听器
    this.setupClientListeners(name, client);

    // 尝试连接
    await this.connect(name);

    this.emit('connectionCreated', { name, connectionInfo });
    logger.info(`MCP connection created: ${name}`);

    return client;
  }

  /**
   * 连接服务器（基于CC源码）
   */
  async connect(name: string): Promise<void> {
    const connectionInfo = this.connections.get(name);

    if (!connectionInfo) {
      throw new Error(`Connection not found: ${name}`);
    }

    if (!connectionInfo.client) {
      throw new Error(`Client not initialized: ${name}`);
    }

    try {
      // 更新连接状态
      connectionInfo.status.state = 'connecting';
      connectionInfo.connectedAt = new Date();

      this.emit('connectionStateChanged', { name, state: 'connecting' });

      // 建立连接
      await connectionInfo.client.connect();

      // 更新连接状态
      connectionInfo.status.state = 'connected';
      connectionInfo.status.retryCount = 0;

      this.emit('connectionStateChanged', { name, state: 'connected' });

      // 注册工具和资源
      await this.registerServerTools(name, connectionInfo.client);

      logger.info(`✅ MCP connection established: ${name}`);
    } catch (error) {
      connectionInfo.status.errorCount++; // 更新连接状态
      connectionInfo.status.state = 'error';
      connectionInfo.status.error =
        error instanceof Error ? error.message : String(error);
      connectionInfo.disconnectedAt = new Date();

      this.emit('connectionStateChanged', {
        name,
        state: 'error',
        error: connectionInfo.status.error,
      });

      // 处理重连
      this.handleReconnect(name, connectionInfo);

      throw error;
    }
  }

  /**
   * 断开连接（基于CC源码）
   */
  async disconnect(name: string): Promise<void> {
    const connectionInfo = this.connections.get(name);

    if (!connectionInfo) {
      throw new Error(`Connection not found: ${name}`);
    }

    if (!connectionInfo.client) {
      throw new Error(`Client not initialized: ${name}`);
    }

    try {
      // 取消重连定时器
      this.cancelReconnect(name);

      // 更新连接状态
      connectionInfo.status.state = 'disconnecting';

      this.emit('connectionStateChanged', { name, state: 'disconnecting' });

      // 断开连接
      await connectionInfo.client.disconnect();

      // 更新连接状态
      connectionInfo.status.state = 'disconnected';
      connectionInfo.disconnectedAt = new Date();

      this.emit('connectionStateChanged', { name, state: 'disconnected' });

      // 清理工具和资源注册
      this.cleanupServerRegistrations(name);

      logger.info(`✅ MCP connection disconnected: ${name}`);
    } catch (error) {
      // 更新连接状态
      connectionInfo.status.state = 'error';
      connectionInfo.status.error =
        error instanceof Error ? error.message : String(error);

      this.emit('connectionStateChanged', {
        name,
        state: 'error',
        error: connectionInfo.status.error,
      });

      throw error;
    }
  }

  /**
   * 重新连接（基于CC源码）
   */
  async reconnect(name: string): Promise<void> {
    const connectionInfo = this.connections.get(name);

    if (!connectionInfo) {
      throw new Error(`Connection not found: ${name}`);
    }

    // 取消现有的重连定时器
    this.cancelReconnect(name);

    // 先断开连接
    try {
      await this.disconnect(name);
    } catch (error) {
      // 忽略断开连接的错误
    }

    // 重新连接
    await this.connect(name);
  }

  /**
   * 移除连接（基于CC源码）
   */
  async removeConnection(name: string): Promise<void> {
    const connectionInfo = this.connections.get(name);

    if (!connectionInfo) {
      throw new Error(`Connection not found: ${name}`);
    }

    // 取消重连定时器
    this.cancelReconnect(name);

    // 断开连接
    if (
      connectionInfo.client &&
      connectionInfo.status.state !== 'disconnected'
    ) {
      await this.disconnect(name);
    }

    // 移除连接
    this.connections.delete(name);

    this.emit('connectionRemoved', { name });
    logger.info(`✅ MCP connection removed: ${name}`);
  }

  /**
   * 开始新会话（基于CC源码）
   */
  startSession(sessionId?: string): string {
    const id = sessionId || this.generateSessionId();

    if (this.sessions.has(id)) {
      throw new Error(`Session already exists: ${id}`);
    }

    const sessionInfo: MCPSessionInfo = {
      id,
      startedAt: new Date(),
      connectedServers: [],
      stats: {
        totalToolCalls: 0,
        totalResourceReads: 0,
        totalPromptGets: 0,
        totalErrors: 0,
        totalDuration: 0,
      },
    };

    this.sessions.set(id, sessionInfo);
    this.currentSessionId = id;

    this.emit('sessionStarted', { sessionId: id, sessionInfo });
    logger.info(`✅ MCP session started: ${id}`);

    return id;
  }

  /**
   * 结束会话（基于CC源码）
   */
  endSession(sessionId?: string): void {
    const id = sessionId || this.currentSessionId;

    if (!id) {
      throw new Error('No active session');
    }

    const sessionInfo = this.sessions.get(id);

    if (!sessionInfo) {
      throw new Error(`Session not found: ${id}`);
    }

    sessionInfo.endedAt = new Date();
    sessionInfo.stats.totalDuration =
      sessionInfo.endedAt.getTime() - sessionInfo.startedAt.getTime();

    if (this.currentSessionId === id) {
      this.currentSessionId = undefined;
    }

    this.emit('sessionEnded', { sessionId: id, sessionInfo });
    logger.info(`✅ MCP session ended: ${id}`);
  }

  /**
   * 获取连接信息（基于CC源码）
   */
  getConnection(name: string): MCPConnectionInfo | undefined {
    return this.connections.get(name);
  }

  /**
   * 获取所有连接（基于CC源码）
   */
  getAllConnections(): MCPConnectionInfo[] {
    return Array.from(this.connections.values());
  }

  /**
   * 获取会话信息（基于CC源码）
   */
  getSession(sessionId: string): MCPSessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 获取当前会话（基于CC源码）
   */
  getCurrentSession(): MCPSessionInfo | undefined {
    return this.currentSessionId
      ? this.sessions.get(this.currentSessionId)
      : undefined;
  }

  /**
   * 获取所有会话（基于CC源码）
   */
  getAllSessions(): MCPSessionInfo[] {
    return Array.from(this.sessions.values());
  }

  /**
   * 获取连接统计（基于CC源码）
   */
  getConnectionStats(): {
    totalConnections: number;
    connectedConnections: number;
    disconnectedConnections: number;
    errorConnections: number;
    totalSessions: number;
    activeSessions: number;
  } {
    const connections = Array.from(this.connections.values());
    const sessions = Array.from(this.sessions.values());

    return {
      totalConnections: connections.length,
      connectedConnections: connections.filter(
        (c) => c.status.state === 'connected'
      ).length,
      disconnectedConnections: connections.filter(
        (c) => c.status.state === 'disconnected'
      ).length,
      errorConnections: connections.filter((c) => c.status.state === 'error')
        .length,
      totalSessions: sessions.length,
      activeSessions: sessions.filter((s) => !s.endedAt).length,
    };
  }

  /**
   * 设置自动重连（基于CC源码）
   */
  setAutoReconnect(name: string, enabled: boolean): void {
    const connectionInfo = this.connections.get(name);

    if (!connectionInfo) {
      throw new Error(`Connection not found: ${name}`);
    }

    connectionInfo.status.autoReconnect = enabled;

    if (!enabled) {
      this.cancelReconnect(name);
    }

    this.emit('autoReconnectChanged', { name, enabled });
  }

  /**
   * 清理所有连接（基于CC源码）
   */
  async cleanup(): Promise<void> {
    // 结束当前会话
    if (this.currentSessionId) {
      this.endSession(this.currentSessionId);
    }

    // 断开所有连接
    const disconnectPromises = Array.from(this.connections.keys()).map(
      async (name) => {
        try {
          await this.removeConnection(name);
        } catch (error) {
          logger.warning(`Failed to remove connection ${name}:`, { error });
        }
      }
    );

    await Promise.all(disconnectPromises);

    // 清理重连定时器
    for (const [name, timer] of this.reconnectTimers.entries()) {
      clearTimeout(timer);
      this.reconnectTimers.delete(name);
    }

    this.emit('cleanupCompleted');
    logger.info('MCP connection manager cleanup completed');
  }

  /**
   * 创建客户端实例（基于CC源码）
   */
  private async createClient(
    name: string,
    config: ScopedMcpServerConfig,
    connectionConfig?: MCPConnectionConfig
  ): Promise<MCPClient> {
    // 这里应该根据配置创建具体的传输层
    // 目前返回一个模拟的客户端

    const mockTransport = {
      name,
      state: 'disconnected' as MCPClientState,

      async connect(): Promise<void> {
        this.state = 'connected';
      },

      async disconnect(): Promise<void> {
        this.state = 'disconnected';
      },

      async send(request: any): Promise<void> {
        // 模拟发送请求
      },

      async *receive(): AsyncIterable<any> {
        // 模拟接收响应
        yield {};
      },

      on(event: string, listener: (...args: any[]) => void): void {
        // 模拟事件监听
      },
    };

    return new MCPClientImpl(mockTransport as any);
  }

  /**
   * 设置客户端事件监听器（基于CC源码）
   */
  private setupClientListeners(name: string, client: MCPClient): void {
    client.on('event' as unknown as MCPEventType, (event) => {
      this.emit('clientEvent', { name, event });
    });

    client.on('state_change', (event) => {
      const connectionInfo = this.connections.get(name);
      if (connectionInfo) {
        connectionInfo.status.state = event.data.newState;
        connectionInfo.status.lastActivity = new Date();

        this.emit('connectionStateChanged', {
          name,
          state: event.data.newState,
          oldState: event.data.oldState,
        });
      }
    });

    client.on('error', (event) => {
      const connectionInfo = this.connections.get(name);
      if (connectionInfo) {
        connectionInfo.status.error = event.data.error.message;
        connectionInfo.status.lastActivity = new Date();

        this.emit('connectionError', { name, error: event.data.error });
      }
    });
  }

  /**
   * 处理重连逻辑（基于CC源码）
   */
  private handleReconnect(
    name: string,
    connectionInfo: MCPConnectionInfo
  ): void {
    if (!connectionInfo.status.autoReconnect) {
      return;
    }

    if (connectionInfo.status.retryCount >= this.maxRetries) {
      logger.warning(`Max retries reached for connection: ${name}`);
      return;
    }

    connectionInfo.status.retryCount++;

    const retryDelay =
      this.retryInterval * Math.pow(2, connectionInfo.status.retryCount - 1);

    logger.info(
      `Scheduling reconnect for ${name} in ${retryDelay}ms (attempt ${connectionInfo.status.retryCount})`
    );

    const timer = setTimeout(async () => {
      try {
        await this.reconnect(name);
      } catch (error) {
        logger.warning(`Reconnect failed for ${name}:`, { error });
      }
    }, retryDelay);

    this.reconnectTimers.set(name, timer);
  }

  /**
   * 取消重连（基于CC源码）
   */
  private cancelReconnect(name: string): void {
    const timer = this.reconnectTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(name);
    }
  }

  /**
   * 注册服务器工具（基于CC源码）
   */
  private async registerServerTools(
    name: string,
    client: MCPClient
  ): Promise<void> {
    try {
      // 获取服务器工具
      const tools = await client.listTools();

      // 注册工具
      globalMCPToolManager.registerTools(name, tools);

      // 获取服务器资源
      const resources = await client.listResources();

      // 注册资源
      globalMCPToolManager.registerResources(name, resources);

      // 获取服务器提示
      const prompts = await client.listPrompts();

      // 注册提示
      globalMCPToolManager.registerPrompts(name, prompts);

      logger.info(
        `Registered ${tools.length} tools, ${resources.length} resources, ${prompts.length} prompts for ${name}`
      );
    } catch (error) {
      logger.warning(`Failed to register tools for ${name}:`, { error });
    }
  }

  /**
   * 清理服务器注册（基于CC源码）
   */
  private cleanupServerRegistrations(name: string): void {
    globalMCPToolManager.clearServerRegistrations(name);
  }

  /**
   * 创建初始统计信息（基于CC源码）
   */
  private createInitialStats(): MCPConnectionStats {
    const now = new Date();
    return {
      connectedAt: now,
      toolCalls: 0,
      resourceReads: 0,
      promptGets: 0,
      errors: 0,
      lastActivity: now,
      averageResponseTime: 0,
    };
  }

  /**
   * 生成会话ID（基于CC源码）
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * 全局MCP连接管理器实例（基于CC源码）
 */
export const globalMCPConnectionManager = new MCPConnectionManager();

export default MCPConnectionManager;
