/**
 * MCP服务器管理器
 * 标准层实现，负责管理多个MCP服务器连接
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { handleError } from '@modules/error/handleError';

const logger = new Logger({ level: LogLevel.INFO });
import {
  type MCPServerConfig,
  type MCPServerConnectionInfo,
  MCPServerStatus,
  type MCPToolDefinition,
  type ScopedMcpServerConfig,
} from './types';
import { MCPConnection } from './MCPConnection';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * 服务器统计信息
 */
interface ServerStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  lastRequestTime: number;
  responseTime: number;
}

/**
 * MCP服务器管理器
 */
export class MCPServerManager {
  private servers: Map<string, MCPConnection> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private autoReconnectInterval: NodeJS.Timeout | null = null;
  private toolCache: Map<string, Map<string, MCPToolDefinition>> = new Map();
  private serverStats: Map<string, ServerStats> = new Map();
  private connectionPool: Map<string, MCPConnection> = new Map();
  private maxConnections: number = 10;
  private connectionTimeout: number = 30000;
  private lastLoadBalancerIndex: number = 0;

  /**
   * 初始化服务器管理器
   */
  constructor() {}

  /**
   * 初始化服务器管理器
   */
  async initialize(): Promise<void> {
    this.startHealthChecks();
    this.startAutoReconnect();
  }

  /**
   * 添加服务器
   */
  addServer(name: string, config: MCPServerConfig): void {
    const connection = new MCPConnection(name, config);
    this.servers.set(name, connection);
    this.toolCache.set(name, new Map());
    this.serverStats.set(name, {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      lastRequestTime: 0,
      responseTime: 0,
    });
    logger.info(`Added MCP server: ${name}`);
  }

  /**
   * 获取服务器
   */
  getServer(name: string): MCPConnection | undefined {
    return this.servers.get(name);
  }

  /**
   * 移除服务器
   */
  removeServer(name: string): void {
    const server = this.servers.get(name);
    if (server) {
      server.disconnect();
      this.servers.delete(name);
      this.toolCache.delete(name);
      this.serverStats.delete(name);
      this.connectionPool.delete(name);
      logger.info(`Removed MCP server: ${name}`);
    }
  }

  /**
   * 列出所有服务器
   */
  listServers(): string[] {
    return Array.from(this.servers.keys());
  }

  /**
   * 获取所有服务器信息
   */
  getServerInfos(): MCPServerConnectionInfo[] {
    return Array.from(this.servers.values()).map((connection) => {
      const stats = this.serverStats.get(connection.getName());
      return {
        name: connection.getName(),
        config: connection.getConfig(),
        status: connection.getStatus(),
        tools: connection.getTools(),
        error: connection.getError(),
        stats: stats,
      };
    });
  }

  /**
   * 连接到所有服务器
   */
  async connectAll(): Promise<void> {
    const connectPromises = Array.from(this.servers.entries()).map(
      async ([name, connection]) => {
        try {
          const success = await connection.connect();
          if (success) {
            logger.info(`Connected to MCP server: ${name}`);
            await this.refreshServerTools(name);
          }
        } catch (error: any) {
          await handleError(error, { module: 'services:mcp:server', action: 'connect_server', context: { serverName: name } });
        }
      }
    );

    await Promise.all(connectPromises);
  }

  /**
   * 断开所有服务器连接
   */
  disconnectAll(): void {
    for (const connection of this.servers.values()) {
      connection.disconnect();
    }
    this.connectionPool.clear();
    logger.info('Disconnected from all MCP servers');
  }

  /**
   * 调用工具
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new AppError(
        `MCP server not found: ${serverName}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const startTime = Date.now();
    const stats = this.serverStats.get(serverName)!;
    stats.totalRequests++;

    try {
      if (server.getStatus() !== MCPServerStatus.CONNECTED) {
        await server.connect();
      }

      const result = await server.callTool(toolName, args);
      stats.successfulRequests++;
      stats.responseTime = Date.now() - startTime;
      stats.lastRequestTime = Date.now();

      return result;
    } catch (error) {
      stats.failedRequests++;
      stats.responseTime = Date.now() - startTime;
      stats.lastRequestTime = Date.now();
      throw error;
    }
  }

  /**
   * 批量调用工具
   */
  async batchCallTools(
    calls: Array<{
      serverName: string;
      toolName: string;
      args: Record<string, unknown>;
    }>
  ): Promise<Array<{ success: boolean; result?: any; error?: string }>> {
    const callPromises = calls.map(async (call) => {
      try {
        const result = await this.callTool(
          call.serverName,
          call.toolName,
          call.args
        );
        return { success: true, result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    return Promise.all(callPromises);
  }

  /**
   * 获取服务器工具列表
   */
  async getServerTools(serverName: string): Promise<MCPServerConnectionInfo> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new AppError(
        `MCP server not found: ${serverName}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    await this.refreshServerTools(serverName);

    return {
      name: server.getName(),
      config: server.getConfig(),
      status: server.getStatus(),
      tools: server.getTools(),
      error: server.getError(),
    };
  }

  /**
   * 刷新服务器工具列表
   */
  private async refreshServerTools(serverName: string): Promise<void> {
    const server = this.servers.get(serverName);
    if (!server) {
      return;
    }

    try {
      await server.refreshTools();
      const tools = server.getTools();
      const toolMap = this.toolCache.get(serverName);
      if (toolMap) {
        toolMap.clear();
        tools.forEach((tool) => {
          toolMap.set(tool.name, tool);
        });
      }
      logger.debug(
        `Refreshed tools for server ${serverName}: ${tools.length} tools`
      );
    } catch (error: any) {
      await handleError(error, { module: 'services:mcp:server', action: 'refresh_server_tools', context: { serverName } });
    }
  }

  /**
   * 批量刷新工具列表
   */
  async batchRefreshTools(): Promise<void> {
    const refreshPromises = Array.from(this.servers.keys()).map(
      async (serverName) => {
        await this.refreshServerTools(serverName);
      }
    );

    await Promise.all(refreshPromises);
  }

  /**
   * 获取所有服务器的工具列表
   */
  getAllTools(): Map<string, MCPToolDefinition[]> {
    const allTools = new Map<string, MCPToolDefinition[]>();
    this.servers.forEach((server, name) => {
      allTools.set(name, server.getTools());
    });
    return allTools;
  }

  /**
   * 按工具名称搜索工具
   */
  searchTools(
    toolName: string
  ): Array<{ server: string; tool: MCPToolDefinition }> {
    const results: Array<{ server: string; tool: MCPToolDefinition }> = [];
    this.servers.forEach((server, serverName) => {
      const tools = server.getTools();
      const matchingTools = tools.filter((tool) =>
        tool.name.includes(toolName)
      );
      matchingTools.forEach((tool) => {
        results.push({ server: serverName, tool });
      });
    });
    return results;
  }

  /**
   * 启动健康检查
   */
  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(async () => {
      const healthyServers = this.getHealthyServers();
      if (healthyServers.length === 0) {
        return;
      }

      const healthCheckPromises = healthyServers.map(async (serverName) => {
        const server = this.servers.get(serverName);
        if (server && server.getStatus() === MCPServerStatus.CONNECTED) {
          try {
            await server.ping();
          } catch (error) {
            logger.warn(`MCP server ${serverName} health check failed`, {
              error,
            });
            server.setStatus(MCPServerStatus.ERROR);
          }
        }
      });

      await Promise.all(healthCheckPromises);
    }, 30000);
  }

  /**
   * 启动自动重连
   */
  private startAutoReconnect(): void {
    this.autoReconnectInterval = setInterval(async () => {
      const serversToReconnect = Array.from(this.servers.entries()).filter(
        ([_, connection]) => {
          const status = connection.getStatus();
          return (
            status === MCPServerStatus.DISCONNECTED ||
            status === MCPServerStatus.ERROR
          );
        }
      );

      if (serversToReconnect.length === 0) {
        return;
      }

      const reconnectPromises = serversToReconnect.map(
        async ([name, connection]) => {
          try {
            logger.info(`Attempting to reconnect to MCP server: ${name}`);
            const success = await connection.connect();
            if (success) {
              logger.info(`Successfully reconnected to MCP server: ${name}`);
              await this.refreshServerTools(name);
            }
          } catch (error: any) {
            await handleError(error, { module: 'services:mcp:server', action: 'reconnect_server', context: { serverName: name } });
          }
        }
      );

      await Promise.all(reconnectPromises);
    }, 60000);
  }

  /**
   * 从配置初始化（替代 MCPConnectionManager.initialize）
   */
  async initializeFromConfigs(
    configs: Record<string, ScopedMcpServerConfig>
  ): Promise<void> {
    for (const [name, config] of Object.entries(configs)) {
      this.addServer(name, config);
    }
    await this.connectAll();
    logger.info(
      `Initialized ${Object.keys(configs).length} MCP servers from configs`
    );
  }

  /**
   * 重连指定服务器
   */
  async reconnectServer(serverName: string): Promise<void> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new AppError(
        `MCP server not found: ${serverName}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    server.disconnect();
    const success = await server.connect();
    if (success) {
      logger.info(`Reconnected to MCP server: ${serverName}`);
      await this.refreshServerTools(serverName);
    } else {
      logger.warn(`Failed to reconnect to MCP server: ${serverName}`);
    }
  }

  /**
   * 切换服务器启用状态
   */
  async toggleServer(serverName: string): Promise<void> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new AppError(
        `MCP server not found: ${serverName}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    if (server.getStatus() === MCPServerStatus.CONNECTED) {
      server.disconnect();
      logger.info(`Disconnected MCP server: ${serverName}`);
    } else {
      const success = await server.connect();
      if (success) {
        logger.info(`Connected MCP server: ${serverName}`);
        await this.refreshServerTools(serverName);
      }
    }
  }

  /**
   * 关闭所有连接（异步清理）
   */
  async closeAll(): Promise<void> {
    this.disconnectAll();
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    if (this.autoReconnectInterval) {
      clearInterval(this.autoReconnectInterval);
      this.autoReconnectInterval = null;
    }
    logger.info('Closed all MCP server connections');
  }

  /**
   * 关闭服务器管理器
   */
  shutdown(): void {
    this.disconnectAll();
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.autoReconnectInterval) {
      clearInterval(this.autoReconnectInterval);
    }
    logger.info('MCP server manager shutdown');
  }

  /**
   * 获取健康的服务器列表
   */
  getHealthyServers(): string[] {
    const healthyServers: string[] = [];
    this.servers.forEach((server, name) => {
      if (server.getStatus() === MCPServerStatus.CONNECTED) {
        healthyServers.push(name);
      }
    });
    return healthyServers;
  }

  /**
   * 选择最佳服务器（负载均衡）
   */
  selectBestServer(): string | undefined {
    const healthyServers = this.getHealthyServers();
    if (healthyServers.length === 0) {
      return undefined;
    }

    if (healthyServers.length === 1) {
      return healthyServers[0];
    }

    this.lastLoadBalancerIndex =
      (this.lastLoadBalancerIndex + 1) % healthyServers.length;
    return healthyServers[this.lastLoadBalancerIndex];
  }

  /**
   * 基于性能选择服务器
   */
  selectServerByPerformance(): string | undefined {
    const healthyServers = this.getHealthyServers();
    if (healthyServers.length === 0) {
      return undefined;
    }

    if (healthyServers.length === 1) {
      return healthyServers[0];
    }

    let bestServer: string | undefined;
    let bestResponseTime = Infinity;

    healthyServers.forEach((serverName) => {
      const stats = this.serverStats.get(serverName);
      if (stats && stats.responseTime < bestResponseTime) {
        bestResponseTime = stats.responseTime;
        bestServer = serverName;
      }
    });

    return bestServer || healthyServers[0];
  }

  /**
   * 获取服务器统计信息
   */
  getServerStats(serverName: string): ServerStats | undefined {
    return this.serverStats.get(serverName);
  }

  /**
   * 清理超时连接
   */
  cleanupConnections(): void {
    const now = Date.now();
    const serversToCleanup: string[] = [];

    this.servers.forEach((server, name) => {
      const stats = this.serverStats.get(name);
      if (stats && now - stats.lastRequestTime > this.connectionTimeout) {
        serversToCleanup.push(name);
      }
    });

    serversToCleanup.forEach((serverName) => {
      const server = this.servers.get(serverName);
      if (server && server.getStatus() === MCPServerStatus.CONNECTED) {
        server.disconnect();
        logger.info(`Cleaned up idle connection: ${serverName}`);
      }
    });
  }

  /**
   * 获取连接池状态
   */
  getConnectionPoolStatus(): {
    totalServers: number;
    healthyServers: number;
    totalConnections: number;
  } {
    return {
      totalServers: this.servers.size,
      healthyServers: this.getHealthyServers().length,
      totalConnections: this.connectionPool.size,
    };
  }
}

let mcpServerManagerInstance: MCPServerManager | null = null;

/**
 * 获取MCP服务器管理器实例
 */
export function getMCPServerManager(): MCPServerManager {
  if (!mcpServerManagerInstance) {
    mcpServerManagerInstance = new MCPServerManager();
  }
  return mcpServerManagerInstance;
}
