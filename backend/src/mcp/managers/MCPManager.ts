// @ts-nocheck
/**
 * MCP管理器
 * 负责管理MCP系统的高级功能
 */

import { MCPServerManager } from './MCPServerManager.js';
import { MCPServerConfig, MCPToolDefinition } from '../types';
import { logger } from '@modules/utils/log';

/**
 * 通道通知监听器
 */
type ChannelNotificationListener = (channel: string, message: any) => void;

/**
 * 命令执行结果
 */
interface CommandExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
}

/**
 * 资源信息
 */
interface ResourceInfo {
  name: string;
  type: string;
  size: number;
  path: string;
  lastModified: string;
}

/**
 * MCP管理器
 */
export class MCPManager {
  private serverManager: MCPServerManager;
  private notificationListeners: Map<string, ChannelNotificationListener[]> = new Map();
  private commandHistory: Array<{
    id: string;
    command: string;
    args: Record<string, any>;
    server: string;
    timestamp: number;
    result?: any;
  }> = [];
  private resourceCache: Map<string, Map<string, ResourceInfo>> = new Map(); // serverName -> resourcePath -> ResourceInfo

  constructor() {
    this.serverManager = new MCPServerManager();
  }

  /**
   * 初始化MCP管理器
   */
  async initialize(): Promise<void> {
    await this.serverManager.initialize();
    logger.info('MCP manager initialized');
  }

  /**
   * 关闭MCP管理器
   */
  async shutdown(): Promise<void> {
    await this.serverManager.shutdown();
    this.notificationListeners.clear();
    this.commandHistory = [];
    this.resourceCache.clear();
    logger.info('MCP manager shutdown');
  }

  /**
   * 获取服务器管理器
   */
  getServerManager(): MCPServerManager {
    return this.serverManager;
  }

  /**
   * 添加MCP服务器
   */
  addServer(name: string, config: MCPServerConfig): void {
    this.serverManager.addServer(name, config);
    logger.info(`Added MCP server: ${name}`);
  }

  /**
   * 移除MCP服务器
   */
  removeServer(name: string): void {
    this.serverManager.removeServer(name);
    this.notificationListeners.delete(name);
    this.resourceCache.delete(name);
    logger.info(`Removed MCP server: ${name}`);
  }

  /**
   * 连接到所有服务器
   */
  async connectAll(): Promise<void> {
    await this.serverManager.connectAll();
  }

  /**
   * 调用工具
   */
  async callTool(serverName: string, toolName: string, args: Record<string, any>): Promise<any> {
    return this.serverManager.callTool(serverName, toolName, args);
  }

  // ==================== 通道通知功能 ====================

  /**
   * 订阅通道通知
   */
  subscribeToChannel(serverName: string, channel: string, listener: ChannelNotificationListener): void {
    const key = `${serverName}:${channel}`;
    if (!this.notificationListeners.has(key)) {
      this.notificationListeners.set(key, []);
    }
    this.notificationListeners.get(key)!.push(listener);
    logger.info(`Subscribed to channel ${channel} on server ${serverName}`);
  }

  /**
   * 取消订阅通道通知
   */
  unsubscribeFromChannel(serverName: string, channel: string, listener: ChannelNotificationListener): void {
    const key = `${serverName}:${channel}`;
    const listeners = this.notificationListeners.get(key);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
        logger.info(`Unsubscribed from channel ${channel} on server ${serverName}`);
      }
    }
  }

  /**
   * 发布通道通知
   */
  publishToChannel(serverName: string, channel: string, message: any): void {
    const key = `${serverName}:${channel}`;
    const listeners = this.notificationListeners.get(key);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(channel, message);
        } catch (error) {
          logger.error(`Error in channel listener:`, error);
        }
      });
    }
  }

  // ==================== 命令管理功能 ====================

  /**
   * 执行MCP命令
   */
  async executeCommand(serverName: string, command: string, args: Record<string, any>): Promise<CommandExecutionResult> {
    const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const result = await this.serverManager.callTool(serverName, command, args);
      
      // 记录命令执行历史
      this.commandHistory.push({
        id: commandId,
        command,
        args,
        server: serverName,
        timestamp: Date.now(),
        result,
      });
      
      // 限制历史记录大小
      if (this.commandHistory.length > 1000) {
        this.commandHistory.shift();
      }
      
      logger.info(`Command executed successfully: ${command} on ${serverName}`);
      return {
        success: true,
        result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // 记录失败的命令
      this.commandHistory.push({
        id: commandId,
        command,
        args,
        server: serverName,
        timestamp: Date.now(),
      });
      
      logger.error(`Command execution failed: ${command} on ${serverName}: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 获取命令执行历史
   */
  getCommandHistory(limit: number = 100): Array<{
    id: string;
    command: string;
    args: Record<string, any>;
    server: string;
    timestamp: number;
    result?: any;
  }> {
    return this.commandHistory.slice(-limit).reverse();
  }

  /**
   * 清理命令执行历史
   */
  clearCommandHistory(): void {
    this.commandHistory = [];
    logger.info('Command history cleared');
  }

  // ==================== 资源管理功能 ====================

  /**
   * 列出服务器资源
   */
  async listResources(serverName: string, path: string = '/'): Promise<ResourceInfo[]> {
    try {
      const result = await this.serverManager.callTool(serverName, 'list_resources', { path });
      
      // 缓存资源信息
      if (!this.resourceCache.has(serverName)) {
        this.resourceCache.set(serverName, new Map());
      }
      
      const serverCache = this.resourceCache.get(serverName)!;
      if (Array.isArray(result)) {
        result.forEach((resource: any) => {
          serverCache.set(resource.path, {
            name: resource.name,
            type: resource.type,
            size: resource.size || 0,
            path: resource.path,
            lastModified: resource.lastModified || new Date().toISOString(),
          });
        });
      }
      
      return result;
    } catch (error) {
      logger.error(`Failed to list resources on ${serverName}:`, error);
      throw error;
    }
  }

  /**
   * 读取服务器资源
   */
  async readResource(serverName: string, path: string): Promise<any> {
    try {
      const result = await this.serverManager.callTool(serverName, 'read_resource', { path });
      logger.info(`Resource read successfully: ${path} on ${serverName}`);
      return result;
    } catch (error) {
      logger.error(`Failed to read resource ${path} on ${serverName}:`, error);
      throw error;
    }
  }

  /**
   * 写入服务器资源
   */
  async writeResource(serverName: string, path: string, content: any): Promise<boolean> {
    try {
      await this.serverManager.callTool(serverName, 'write_resource', { path, content });
      
      // 更新缓存
      if (this.resourceCache.has(serverName)) {
        const serverCache = this.resourceCache.get(serverName)!;
        const resourceInfo = serverCache.get(path);
        if (resourceInfo) {
          resourceInfo.lastModified = new Date().toISOString();
        }
      }
      
      logger.info(`Resource written successfully: ${path} on ${serverName}`);
      return true;
    } catch (error) {
      logger.error(`Failed to write resource ${path} on ${serverName}:`, error);
      return false;
    }
  }

  /**
   * 删除服务器资源
   */
  async deleteResource(serverName: string, path: string): Promise<boolean> {
    try {
      await this.serverManager.callTool(serverName, 'delete_resource', { path });
      
      // 更新缓存
      if (this.resourceCache.has(serverName)) {
        const serverCache = this.resourceCache.get(serverName)!;
        serverCache.delete(path);
      }
      
      logger.info(`Resource deleted successfully: ${path} on ${serverName}`);
      return true;
    } catch (error) {
      logger.error(`Failed to delete resource ${path} on ${serverName}:`, error);
      return false;
    }
  }

  /**
   * 获取缓存的资源信息
   */
  getCachedResourceInfo(serverName: string, path: string): ResourceInfo | undefined {
    if (this.resourceCache.has(serverName)) {
      return this.resourceCache.get(serverName)!.get(path);
    }
    return undefined;
  }

  /**
   * 清理资源缓存
   */
  clearResourceCache(serverName?: string): void {
    if (serverName) {
      this.resourceCache.delete(serverName);
      logger.info(`Resource cache cleared for server: ${serverName}`);
    } else {
      this.resourceCache.clear();
      logger.info('Resource cache cleared for all servers');
    }
  }

  // ==================== 工具管理功能 ====================

  /**
   * 获取所有服务器的工具列表
   */
  async getAllTools(): Promise<Map<string, MCPToolDefinition[]>> {
    return this.serverManager.getAllTools();
  }

  /**
   * 按工具名称搜索工具
   */
  searchTools(toolName: string): Array<{ server: string; tool: MCPToolDefinition }> {
    return this.serverManager.searchTools(toolName);
  }

  /**
   * 批量刷新工具列表
   */
  async refreshAllTools(): Promise<void> {
    const servers = this.serverManager.listServers();
    for (const server of servers) {
      try {
        await this.serverManager.getServerTools(server);
      } catch (error) {
        logger.error(`Failed to refresh tools for server ${server}:`, error);
      }
    }
  }

  // ==================== 服务器管理功能 ====================

  /**
   * 获取服务器状态
   */
  getServerStatus(serverName: string): string {
    const server = this.serverManager.getServer(serverName);
    return server ? server.getStatus() : 'NOT_FOUND';
  }

  /**
   * 获取所有服务器信息
   */
  getServerInfos(): Array<{
    name: string;
    status: string;
    error?: string;
    toolCount: number;
  }> {
    const infos = this.serverManager.getServerInfos();
    return infos.map(info => ({
      name: info.name,
      status: info.status,
      error: info.error,
      toolCount: info.tools.length,
    }));
  }

  /**
   * 选择最佳服务器
   */
  selectBestServer(): string | undefined {
    return this.serverManager.selectBestServer();
  }

  /**
   * 获取MCP命令列表
   */
  async getCommands(): Promise<any[]> {
    try {
      const allTools = await this.getAllTools();
      const commands: any[] = [];
      for (const [serverName, tools] of allTools) {
        for (const tool of tools) {
          commands.push({
            type: 'mcp',
            name: tool.name,
            description: tool.description || `MCP tool from ${serverName}`,
            serverName,
            load: async () => ({
              execute: async (args: any) => {
                return this.callTool(serverName, tool.name, typeof args === 'string' ? { args } : args);
              },
            }),
          });
        }
      }
      return commands;
    } catch (error) {
      return [];
    }
  }
}

/**
 * 全局MCP管理器实例
 */
export const mcpManager = new MCPManager();
