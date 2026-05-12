//
/**
 * MCP连接管理器
 * 负责管理MCP服务器连接，包括指数退避重连和批量更新
 */

import { logger } from '@modules/utils/log';
import {
  getMcpToolsCommandsAndResources,
  reconnectMcpServerImpl,
} from './client';
import type {
  MCPServerConnection,
  ScopedMcpServerConfig,
  ServerResource,
  SerializedTool,
} from './types';
import type { McpCommand } from './commandManager';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

// 重连常量
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

// 批量更新常量
const MCP_BATCH_FLUSH_MS = 16;

/**
 * MCP连接管理器
 */
export class MCPConnectionManager {
  private servers: Map<string, MCPServerConnection> = new Map();
  private serverTools: Map<string, SerializedTool[]> = new Map();
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private pendingUpdates: Array<{
    connection: MCPServerConnection;
    tools?: SerializedTool[];
    commands?: McpCommand[];
    resources?: ServerResource[];
  }> = [];
  private flushTimer: NodeJS.Timeout | null = null;

  /**
   * 初始化MCP服务器连接
   */
  async initialize(
    configs: Record<string, ScopedMcpServerConfig>
  ): Promise<void> {
    try {
      // 批量更新回调
      const onConnectionAttempt = (result: {
        connection: MCPServerConnection;
        tools: SerializedTool[];
        commands: McpCommand[];
        resources?: ServerResource[];
      }) => {
        this.updateServer(result);
      };

      await getMcpToolsCommandsAndResources(onConnectionAttempt, configs);
    } catch (error) {
      logger.error(
        'Failed to initialize MCP connections:',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * 更新服务器状态
   */
  private updateServer(update: {
    connection: MCPServerConnection;
    tools?: SerializedTool[];
    commands?: McpCommand[];
    resources?: ServerResource[];
  }): void {
    this.pendingUpdates.push(update);

    // 启动批量更新定时器
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(
        () => this.flushPendingUpdates(),
        MCP_BATCH_FLUSH_MS
      );
    }
  }

  /**
   * 刷新待更新队列
   */
  private flushPendingUpdates(): void {
    if (this.pendingUpdates.length === 0) {
      this.flushTimer = null;
      return;
    }

    const updates = this.pendingUpdates;
    this.pendingUpdates = [];
    this.flushTimer = null;

    // 处理每个更新
    for (const update of updates) {
      const { connection, tools } = update;
      this.servers.set(connection.name, connection);

      if (tools && tools.length > 0) {
        this.serverTools.set(connection.name, tools);
      }

      if (connection.type === 'connected') {
        (connection as any).client.onclose = () =>
          this.handleDisconnect(connection);
      }
    }

    // 触发状态更新事件
    this.emitStateChange();
  }

  /**
   * 处理服务器断开连接
   */
  private handleDisconnect(client: MCPServerConnection): void {
    const configType = client.config.type ?? 'stdio';

    if (configType === 'stdio' || configType === 'sdk') {
      this.updateServer({
        connection: { ...client, type: 'failed' } as MCPServerConnection,
      });
      return;
    }

    // 取消现有的重连尝试
    const existingTimer = this.reconnectTimers.get(client.name);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.reconnectTimers.delete(client.name);
    }

    // 开始指数退避重连
    this.reconnectWithBackoff(client);
  }

  /**
   * 指数退避重连
   */
  private async reconnectWithBackoff(
    client: MCPServerConnection
  ): Promise<void> {
    for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
      // 更新为待连接状态
      this.updateServer({
        connection: {
          ...client,
          type: 'pending',
          reconnectAttempt: attempt,
          maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
        } as MCPServerConnection,
      });

      try {
        const result = await reconnectMcpServerImpl(client.name, client.config);

        if (result.connection.type === 'connected') {
          logger.info(
            `Reconnection successful for server ${client.name} (attempt ${attempt})`
          );
          this.reconnectTimers.delete(client.name);
          this.updateServer(result);
          return;
        }

        // 最后一次尝试失败，更新状态
        if (attempt === MAX_RECONNECT_ATTEMPTS) {
          logger.warn(
            `Max reconnection attempts reached for server ${client.name}`
          );
          this.reconnectTimers.delete(client.name);
          this.updateServer(result);
          return;
        }
      } catch (error) {
        logger.error(
          `Reconnection attempt ${attempt} failed for server ${client.name}:`,
          error instanceof Error ? error : new Error(String(error))
        );

        if (attempt === MAX_RECONNECT_ATTEMPTS) {
          logger.warn(
            `Max reconnection attempts reached for server ${client.name}`
          );
          this.reconnectTimers.delete(client.name);
          this.updateServer({
            connection: {
              ...client,
              type: 'failed',
              error: error instanceof Error ? error.message : 'Unknown error',
            } as MCPServerConnection,
          });
          return;
        }
      }

      // 计算退避时间
      const backoffMs = Math.min(
        INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1),
        MAX_BACKOFF_MS
      );

      logger.info(
        `Scheduling reconnection attempt ${attempt + 1} for server ${client.name} in ${backoffMs}ms`
      );

      // 等待退避时间
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, backoffMs);
        this.reconnectTimers.set(client.name, timer);
      });
    }
  }

  /**
   * 重连指定服务器
   */
  async reconnectServer(serverName: string): Promise<MCPServerConnection> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new AppError(`Server not found: ${serverName}`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    // 取消现有的重连尝试
    const existingTimer = this.reconnectTimers.get(serverName);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.reconnectTimers.delete(serverName);
    }

    // 尝试重连
    const result = await reconnectMcpServerImpl(serverName, server.config);
    this.updateServer({
      connection: result.connection,
      tools: result.tools,
      commands: result.commands,
      resources: result.resources,
    });
    return result.connection;
  }

  /**
   * 切换服务器启用状态
   */
  async toggleServer(serverName: string): Promise<void> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new AppError(`Server not found: ${serverName}`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    // 这里可以实现启用/禁用逻辑
    logger.info(`Toggling server ${serverName}`);
  }

  /**
   * 获取所有服务器
   */
  getServers(): MCPServerConnection[] {
    return Array.from(this.servers.values());
  }

  /**
   * 获取单个服务器
   */
  getServer(name: string): MCPServerConnection | undefined {
    return this.servers.get(name);
  }

  /**
   * 获取指定服务器的序列化工具列表
   */
  getServerTools(serverName: string): SerializedTool[] {
    return this.serverTools.get(serverName) || [];
  }

  /**
   * 获取所有服务器的序列化工具列表（扁平化）
   */
  getAllTools(): Map<string, { serverName: string; tools: SerializedTool[] }> {
    const result = new Map<
      string,
      { serverName: string; tools: SerializedTool[] }
    >();
    for (const [name, tools] of this.serverTools.entries()) {
      result.set(name, { serverName: name, tools });
    }
    return result;
  }

  /**
   * 关闭所有连接
   */
  async closeAll(): Promise<void> {
    // 取消所有重连定时器
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    // 取消批量更新定时器
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // 关闭所有连接
    for (const server of this.servers.values()) {
      if (server.type === 'connected') {
        try {
          await server.cleanup();
        } catch (error) {
          logger.error(
            `Error closing server ${server.name}:`,
            error instanceof Error ? error : new Error(String(error))
          );
        }
      }
    }

    this.servers.clear();
    this.pendingUpdates = [];
  }

  /**
   * 触发状态更新事件
   */
  private emitStateChange(): void {
    // 这里可以实现事件触发逻辑
    logger.debug('MCP state changed');
  }
}

// 导出单例
export const mcpConnectionManager = new MCPConnectionManager();
