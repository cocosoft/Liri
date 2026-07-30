//
/**
 * MCP Proxy 集成
 * 负责与外部 MCP 服务器的集成
 */
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = new Logger({
  module: 'services:mcp:proxy',
  level: LogLevel.INFO,
});
import { mcpConnectionManager } from './MCPConnectionManager';
import {
  registerChannelNotificationHandler,
  removeChannelNotificationHandler,
} from './channelNotification';
import { createChannelPermissionCallbacks } from './channelPermissions';
import { getCommandManager } from './commandManager';
import { resourceManager } from './resourceManager';
import { mcpCacheManager } from './MCPCacheManager';
import type { ConnectedMCPServer } from './types';

/**
 * Proxy集成
 */
export class MCPProxyIntegration {
  private channelPermissionCallbacks = createChannelPermissionCallbacks();
  private connectedServers: Set<string> = new Set();

  /**
   * 初始化Proxy集成
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Proxy integration');
      // 这里可以添加初始化逻辑
    } catch (error) {
      handleError(error, {
        module: 'services:mcp:proxy',
        action: '初始化Proxy集成失败',
      });
    }
  }

  /**
   * 处理服务器连接
   */
  handleServerConnect(server: ConnectedMCPServer): void {
    if (server.config.type === 'claudeai-proxy') {
      this.setupProxyServer(server);
    }
  }

  /**
   * 处理服务器断开连接
   */
  handleServerDisconnect(serverName: string): void {
    if (this.connectedServers.has(serverName)) {
      this.cleanupProxyServer(serverName);
    }
  }

  /**
   * 设置Proxy服务器
   */
  private setupProxyServer(server: ConnectedMCPServer): void {
    try {
      // 注册通道通知处理器
      registerChannelNotificationHandler(server, (content, meta) => {
        this.handleChannelMessage(server.name, content, meta);
      });

      // 加载命令
      this.loadProxyCommands(server);

      // 加载资源
      this.loadProxyResources(server);

      this.connectedServers.add(server.name);
      logger.info(`Proxy server ${server.name} connected and configured`);
    } catch (error) {
      handleError(error, {
        module: 'services:mcp:proxy',
        action: '设置Proxy服务器失败',
      });
    }
  }

  /**
   * 清理Proxy服务器
   */
  private cleanupProxyServer(serverName: string): void {
    try {
      const server = mcpConnectionManager.getServer(serverName);
      if (server && server.type === 'connected') {
        removeChannelNotificationHandler(server);
      }

      // 移除命令和资源
      getCommandManager().removeServerCommands(serverName);
      resourceManager.removeServerResources(serverName);
      mcpCacheManager.clearServerCache(serverName);

      this.connectedServers.delete(serverName);
      logger.info(`Proxy server ${serverName} disconnected and cleaned up`);
    } catch (error) {
      handleError(error, {
        module: 'services:mcp:proxy',
        action: '清理Proxy服务器失败',
      });
    }
  }

  /**
   * 处理通道消息
   */
  private handleChannelMessage(
    serverName: string,
    content: string,
    meta?: any
  ): void {
    try {
      logger.info(
        `Received Proxy channel message from ${serverName}: ${content.slice(0, 80)}`
      );
      // 这里可以添加消息处理逻辑
    } catch (error) {
      handleError(error, {
        module: 'services:mcp:proxy',
        action: '处理通道消息失败',
      });
    }
  }

  /**
   * 加载Proxy命令
   */
  private async loadProxyCommands(server: ConnectedMCPServer): Promise<void> {
    try {
      const commands = await getCommandManager().loadCommandsFromServer(
        server.client,
        server.name
      );
      mcpCacheManager.setCommandCache(server.name, commands as any);
      logger.info(
        `Loaded ${commands.length} Proxy commands from server ${server.name}`
      );
    } catch (error) {
      handleError(error, {
        module: 'services:mcp:proxy',
        action: '加载Proxy命令失败',
      });
    }
  }

  /**
   * 加载Proxy资源
   */
  private async loadProxyResources(server: ConnectedMCPServer): Promise<void> {
    try {
      const resources = await resourceManager.loadResourcesFromServer(
        server.client,
        server.name
      );
      mcpCacheManager.setResourceCache(server.name, resources);
      logger.info(
        `Loaded ${resources.length} Proxy resources from server ${server.name}`
      );
    } catch (error) {
      handleError(error, {
        module: 'services:mcp:proxy',
        action: '加载Proxy资源失败',
      });
    }
  }

  /**
   * 执行Proxy命令
   */
  async executeProxyCommand(
    serverName: string,
    commandName: string,
    args: any
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const fullCommandName = `${serverName}:${commandName}`;
      return await getCommandManager().executeCommand(fullCommandName, args);
    } catch (error) {
      handleError(error, {
        module: 'services:mcp:proxy',
        action: '执行Proxy命令失败',
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 获取Proxy服务器状态
   */
  getProxyServerStatus(): Array<{
    name: string;
    connected: boolean;
    capabilities: any;
  }> {
    const servers: Array<{
      name: string;
      connected: boolean;
      capabilities: any;
    }> = [];

    for (const server of mcpConnectionManager.getServers()) {
      if (server.config.type === 'claudeai-proxy') {
        servers.push({
          name: server.name,
          connected: server.type === 'connected',
          capabilities:
            server.type === 'connected' ? server.capabilities : undefined,
        });
      }
    }

    return servers;
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    for (const serverName of this.connectedServers) {
      this.cleanupProxyServer(serverName);
    }
    this.connectedServers.clear();
    logger.info('Proxy integration cleaned up');
  }
}

// 导出单例
export const mcpProxyIntegration = new MCPProxyIntegration();
