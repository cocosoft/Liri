/**
 * MCP连接管理器（适配层）
 *
 * 将 MCPConnectionManager 改为适配层，内部委托 MCPServerManager 执行核心操作。
 * 保留 MCPServerConnection 联合类型（含 SDK Client）以维持消费者兼容性。
 * MCPServerManager 为唯一的管理器实现。
 *
 * @architecture P3 重构要点：
 * - 移除 servers Map → 新增 clientCache（仅缓存 SDK Client 引用）
 * - 移除 serverTools Map → 委托 MCPServerManager 查询工具
 * - 所有查询操作改为委托 getMCPServerManager()
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'services:mcp:connManager',
  level: LogLevel.INFO,
});
import {
  getMcpToolsCommandsAndResources,
  reconnectMcpServerImpl,
} from './client';
import type {
  ConnectedMCPServer,
  MCPServerConnection,
  ScopedMcpServerConfig,
  ServerResource,
  SerializedTool,
} from './types';
import type { McpCommand } from './commandManager';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
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
  // ==================== 状态字段 ====================
  // ❌ 已移除：servers Map（原存储所有 MCPServerConnection）
  // ❌ 已移除：serverTools Map（原存储序列化工具列表）

  /** SDK Client 引用缓存：仅缓存含有 `.client` 的已连接连接 */
  private clientCache = new Map<string, MCPServerConnection>();

  /** 工具数据缓存：来自初始化流程的 SerializedTool 数据 */
  private toolsCache = new Map<string, SerializedTool[]>();

  /** 重连定时器 */
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();

  /** 待处理的连接状态更新队列 */
  private pendingUpdates: Array<{
    connection: MCPServerConnection;
    tools?: SerializedTool[];
    commands?: McpCommand[];
    resources?: ServerResource[];
  }> = [];

  /** 批量刷新定时器 */
  private flushTimer: NodeJS.Timeout | null = null;

  // ==================== 初始化 ====================

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

      // 启动健康检查和自动重连
      await manager.initialize();
    } catch (error) {
      await handleError(error, {
        module: 'services:mcp:connection',
        action: 'initialize',
      });
    }
  }

  // ==================== 状态更新机制 ====================

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
   * 将待处理更新写入 clientCache 和 toolsCache
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

      // 缓存 SDK Client 引用（所有状态都缓存，供消费者查询状态）
      this.clientCache.set(connection.name, connection);

      // 缓存工具数据
      if (tools && tools.length > 0) {
        this.toolsCache.set(connection.name, tools);
      }

      // 已连接的服务注册 onclose 事件
      if (connection.type === 'connected') {
        (connection as unknown as ConnectedMCPServer).client.onclose = () =>
          this.handleDisconnect(connection);
      }
    }

    this.emitStateChange();
  }

  // ==================== 断开与重连 ====================

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
        await handleError(error, {
          module: 'services:mcp:connection',
          action: 'reconnect_attempt',
          context: { serverName: client.name, attempt },
        });

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

  // ==================== 对外查询接口 ====================

  /**
   * 重连指定服务器
   * 委托 MCPServerManager 执行，同步状态到 clientCache
   */
  async reconnectServer(serverName: string): Promise<MCPServerConnection> {
    const cached = this.clientCache.get(serverName);
    if (!cached) {
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
      const manager = getMCPServerManager();
      await manager.reconnectServer(serverName);
      this.clientCache.set(serverName, {
        ...cached,
        type: 'connected',
      } as MCPServerConnection);
    } catch (error) {
      this.clientCache.set(serverName, {
        ...cached,
        type: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      } as MCPServerConnection);
    }

    return this.clientCache.get(serverName)!;
  }

  /**
   * 切换服务器启用状态
   * 委托 MCPServerManager 执行，同步状态到 clientCache
   */
  async toggleServer(serverName: string): Promise<void> {
    const manager = getMCPServerManager();
    try {
      await manager.toggleServer(serverName);

      const existing = this.clientCache.get(serverName);
      if (existing) {
        // 根据 MCPServerManager 的状态更新 clientCache
        this.clientCache.set(serverName, {
          ...existing,
          type: existing.type === 'connected' ? 'failed' : 'connected',
        } as MCPServerConnection);
      }
    } catch (error) {
      await handleError(error, {
        module: 'services:mcp:connection',
        action: 'toggle_server',
        context: { serverName },
      });
    }
  }

  // ==================== 查询方法 ====================

  /**
   * 获取所有服务器
   * 委托 MCPServerManager.listServers() + clientCache 补充
   */
  getServers(): MCPServerConnection[] {
    const manager = getMCPServerManager();
    const allNames = manager.listServers();
    const seenNames = new Set<string>();

    // 1. 从 clientCache 返回已缓存的连接（含 .client）
    const result: MCPServerConnection[] = [];
    for (const name of allNames) {
      const cached = this.clientCache.get(name);
      if (cached) {
        result.push(cached);
        seenNames.add(name);
      }
    }

    // 2. 对 clientCache 中缓存但 MCPServerManager 已移除的服务进行清理
    for (const [name] of this.clientCache) {
      if (!seenNames.has(name)) {
        // 保留在结果中，供消费者感知已移除状态
        result.push({
          name,
          type: 'failed' as const,
          config: {} as ScopedMcpServerConfig,
          error: 'Server removed from registry',
        });
      }
    }

    // 3. 对 MCPServerManager 中存在但 clientCache 未覆盖的服务构建基本信息
    for (const name of allNames) {
      if (!seenNames.has(name)) {
        const infos = manager.getServerInfos();
        const info = infos.find((i) => i.name === name);
        if (info) {
          result.push({
            name: info.name,
            type: 'failed' as const,
            config: info.config as ScopedMcpServerConfig,
            error: info.error || 'No active connection',
          });
        }
      }
    }

    return result;
  }

  /**
   * 获取单个服务器
   * clientCache 优先，MCPServerManager 后备
   */
  getServer(name: string): MCPServerConnection | undefined {
    // 1. clientCache 优先
    const cached = this.clientCache.get(name);
    if (cached) {
      return cached;
    }

    // 2. MCPServerManager 后备（不含 .client）
    const manager = getMCPServerManager();
    const infos = manager.getServerInfos();
    const info = infos.find((i) => i.name === name);
    if (info) {
      return {
        name: info.name,
        type: 'failed' as const,
        config: info.config as ScopedMcpServerConfig,
        error: info.error || 'No active connection',
      };
    }

    return undefined;
  }

  /**
   * 获取指定服务器的序列化工具列表
   * 委托 toolsCache 查询
   */
  getServerTools(serverName: string): SerializedTool[] {
    return this.toolsCache.get(serverName) || [];
  }

  /**
   * 获取所有服务器的序列化工具列表（扁平化）
   * 委托 toolsCache 构建
   */
  getAllTools(): Map<string, { serverName: string; tools: SerializedTool[] }> {
    const result = new Map<
      string,
      { serverName: string; tools: SerializedTool[] }
    >();
    for (const [name, tools] of this.toolsCache.entries()) {
      result.set(name, { serverName: name, tools });
    }
    return result;
  }

  // ==================== 清理 ====================

  /**
   * 关闭所有连接
   * 委托 MCPServerManager 执行，清理本地缓存
   */
  async closeAll(): Promise<void> {
    const manager = getMCPServerManager();
    await manager.closeAll();

    // 清理重连定时器
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    // 清理批量刷新定时器
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // 清理本地缓存
    this.clientCache.clear();
    this.toolsCache.clear();
    this.pendingUpdates = [];
  }

  // ==================== 内部方法 ====================

  /**
   * 触发状态更新事件
   */
  private emitStateChange(): void {
    logger.debug('MCP state changed');
  }
}

// 导出单例
export const mcpConnectionManager = new MCPConnectionManager();
