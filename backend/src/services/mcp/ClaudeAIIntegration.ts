// @ts-nocheck
/**
 * Claude AI集成
 * 负责与Claude AI MCP服务器的集成
 */

import { logger } from '../../utils/log';
import { mcpConnectionManager } from './MCPConnectionManager';
import { registerChannelNotificationHandler, removeChannelNotificationHandler } from './channelNotification';
import { createChannelPermissionCallbacks } from './channelPermissions';
import { commandManager } from './commandManager';
import { resourceManager } from './resourceManager';
import { mcpCacheManager } from './MCPCacheManager';
import type { ConnectedMCPServer } from './types';

/**
 * Claude AI集成
 */
export class ClaudeAIIntegration {
  private channelPermissionCallbacks = createChannelPermissionCallbacks();
  private connectedServers: Set<string> = new Set();

  /**
   * 初始化Claude AI集成
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Claude AI integration');
      // 这里可以添加初始化逻辑
    } catch (error) {
      logger.error('Failed to initialize Claude AI integration:', error);
    }
  }

  /**
   * 处理服务器连接
   */
  handleServerConnect(server: ConnectedMCPServer): void {
    if (server.config.type === 'claudeai-proxy') {
      this.setupClaudeAIServer(server);
    }
  }

  /**
   * 处理服务器断开连接
   */
  handleServerDisconnect(serverName: string): void {
    if (this.connectedServers.has(serverName)) {
      this.cleanupClaudeAIServer(serverName);
    }
  }

  /**
   * 设置Claude AI服务器
   */
  private setupClaudeAIServer(server: ConnectedMCPServer): void {
    try {
      // 注册通道通知处理器
      registerChannelNotificationHandler(server, (content, meta) => {
        this.handleChannelMessage(server.name, content, meta);
      });

      // 加载命令
      this.loadClaudeAICommands(server);

      // 加载资源
      this.loadClaudeAIResources(server);

      this.connectedServers.add(server.name);
      logger.info(`Claude AI server ${server.name} connected and configured`);
    } catch (error) {
      logger.error(`Failed to setup Claude AI server ${server.name}:`, error);
    }
  }

  /**
   * 清理Claude AI服务器
   */
  private cleanupClaudeAIServer(serverName: string): void {
    try {
      const server = mcpConnectionManager.getServer(serverName);
      if (server && server.type === 'connected') {
        removeChannelNotificationHandler(server);
      }

      // 移除命令和资源
      commandManager.removeServerCommands(serverName);
      resourceManager.removeServerResources(serverName);
      mcpCacheManager.clearServerCache(serverName);

      this.connectedServers.delete(serverName);
      logger.info(`Claude AI server ${serverName} disconnected and cleaned up`);
    } catch (error) {
      logger.error(`Failed to cleanup Claude AI server ${serverName}:`, error);
    }
  }

  /**
   * 处理通道消息
   */
  private handleChannelMessage(serverName: string, content: string, meta?: any): void {
    try {
      logger.info(`Received Claude AI channel message from ${serverName}: ${content.slice(0, 80)}`);
      // 这里可以添加消息处理逻辑
    } catch (error) {
      logger.error('Failed to handle channel message:', error);
    }
  }

  /**
   * 加载Claude AI命令
   */
  private async loadClaudeAICommands(server: ConnectedMCPServer): Promise<void> {
    try {
      const commands = await commandManager.loadCommandsFromServer(server.client, server.name);
      mcpCacheManager.setCommandCache(server.name, commands);
      logger.info(`Loaded ${commands.length} Claude AI commands from server ${server.name}`);
    } catch (error) {
      logger.error(`Failed to load Claude AI commands:`, error);
    }
  }

  /**
   * 加载Claude AI资源
   */
  private async loadClaudeAIResources(server: ConnectedMCPServer): Promise<void> {
    try {
      const resources = await resourceManager.loadResourcesFromServer(server.client, server.name);
      mcpCacheManager.setResourceCache(server.name, resources);
      logger.info(`Loaded ${resources.length} Claude AI resources from server ${server.name}`);
    } catch (error) {
      logger.error(`Failed to load Claude AI resources:`, error);
    }
  }

  /**
   * 执行Claude AI命令
   */
  async executeClaudeAICommand(serverName: string, commandName: string, args: any): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const fullCommandName = `${serverName}:${commandName}`;
      return await commandManager.executeCommand(fullCommandName, args);
    } catch (error) {
      logger.error(`Failed to execute Claude AI command:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * 获取Claude AI服务器状态
   */
  getClaudeAIServerStatus(): Array<{
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
          capabilities: server.type === 'connected' ? server.capabilities : undefined
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
      this.cleanupClaudeAIServer(serverName);
    }
    this.connectedServers.clear();
    logger.info('Claude AI integration cleaned up');
  }
}

// 导出单例
export const claudeAIIntegration = new ClaudeAIIntegration();