/**
 * MCP连接管理器（适配层）
 *
 * 将 MCPConnectionManager 改为适配层，内部委托 MCPServerManager 执行核心操作。
 * 保留 MCPServerConnection 联合类型（含 SDK Client）以维持消费者兼容性。
 * MCPServerManager 为唯一的管理器实现。
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
import { getMCPServerManager } from './MCPServerManager';

// 重连常量
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

// 批量更新常量
const MCP_BATCH_FLUSH_MS = 16;

/**
 * MCP连接管理器（适配层）
 *
 * 管理 MCP 服务器连接状态，内部委托 MCPServerManager 执行连接操作。
 * 保留 MCPServerConnection 联合类型以支持消费者访问 `.client`（SDK Client）。
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
   * 初始化 MCP 服务器连接
   * 使用 client.ts 获取 MCPServerConnection 对象（含 SDK Client），同时注册到 MCPServerManager
   */
  async initialize(
    configs: Record<string, ScopedMcpServerConfig>
  ): Promise<void> {
    try {
      const manager = getMCPServerManager();

      const onConnectionAttempt = (result: {
        connection: MCPServerConnection;
        tools: SerializedTool[];
        commands: McpCommand[];
        resources?: ServerResource[];
      }) => {
        this.updateServer(result);
        const { connection, tools } = result;
        if (connection.type === 'connected') {
          manager.addServer(connection.name, connection.config);
        }
      };

      await getMcpToolsCommandsAndResources(onConnectionAttempt, configs);

      await manager.connectAll();
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

    const existingTimer = this.reconnectTimers.get(client.name);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.reconnectTimers.delete(client.name);
    }

    this.reconnectWithBackoff(client);
  }

  /**
   * 指数退避重连
   */
  private async reconnectWithBackoff(
    client: MCPServerConnection
  ): Promise<void> {
    for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
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

      const backoffMs = Math.min(
        INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1),
        MAX_BACKOFF_MS
      );

      logger.info(
        `Scheduling reconnection attempt ${attempt + 1} for server ${client.name} in ${backoffMs}ms`
      );

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, backoffMs);
        this.reconnectTimers.set(client.name, timer);
      });
    }
  }

  /**
   * 重连指定服务器
   * 委托 MCPServerManager 执行，同步状态到本地
   */
  async reconnectServer(serverName: string): Promise<MCPServerConnection> {
    const manager = getMCPServerManager();
    const server = this.servers.get(serverName);
    if (!server) {
      throw new AppError(
        `Server not found: ${serverName}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const existingTimer = this.reconnectTimers.get(serverName);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.reconnectTimers.delete(serverName);
    }

    try {
      await manager.reconnectServer(serverName);
      this.servers.set(serverName, {
        ...server,
        type: 'connected',
      } as MCPServerConnection);
    } catch (error) {
      this.servers.set(serverName, {
        ...server,
        type: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      } as MCPServerConnection);
    }

    return this.servers.get(serverName)!;
  }

  /**
   * 切换服务器启用状态
   * 委托 MCPServerManager 执行，同步状态到本地
   */
  async toggleServer(serverName: string): Promise<void> {
    const manager = getMCPServerManager();
    try {
      await manager.toggleServer(serverName);

      const mcpServer = manager.getServer(serverName);
      if (mcpServer) {
        const existing = this.servers.get(serverName);
        if (mcpServer.getStatus().toString().includes('CONNECTED')) {
          this.servers.set(serverName, {
            ...existing,
            name: serverName,
            type: 'connected',
          } as MCPServerConnection);
        } else {
          this.servers.set(serverName, {
            ...existing,
            name: serverName,
            type: 'failed',
          } as MCPServerConnection);
        }
      }
    } catch (error) {
      logger.error(
        `Toggle failed for server ${serverName}:`,
        error instanceof Error ? error : new Error(String(error))
      );
    }
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
   * 委托 MCPServerManager 执行，清理本地状态
   */
  async closeAll(): Promise<void> {
    const manager = getMCPServerManager();
    await manager.closeAll();

    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    this.servers.clear();
    this.serverTools.clear();
    this.pendingUpdates = [];
  }

  /**
   * 触发状态更新事件
   */
  private emitStateChange(): void {
    logger.debug('MCP state changed');
  }
}

// 导出单例
export const mcpConnectionManager = new MCPConnectionManager();
