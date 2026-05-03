// @ts-nocheck
/**
 * MCP工具桥接器
 * 将MCP服务器的工具注册到主ToolManager中
 */

import { logger } from '../../utils/log';
import { toolManager } from '../../tools/ToolManager';
import { McpToolWrapper } from './McpToolWrapper';
import { mcpConnectionManager } from './MCPConnectionManager';
import type { Tool } from '../../tools/types/Tool';

/**
 * MCP工具桥接器
 * 负责将MCP服务器的工具映射为Tool接口实例并注册到ToolManager
 */
export class MCPToolBridge {
  private registeredMcpTools: Map<string, Tool> = new Map();
  private initialized = false;

  /**
   * 初始化桥接器
   * 将当前已连接的MCP服务器工具注册到ToolManager
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      logger.info('Initializing MCP tool bridge');
      await this.syncTools();
      this.initialized = true;
      logger.info(`MCP tool bridge initialized: ${this.registeredMcpTools.size} tools registered`);
    } catch (error) {
      logger.error('Failed to initialize MCP tool bridge:', error);
    }
  }

  /**
   * 同步MCP工具到ToolManager
   */
  private async syncTools(): Promise<void> {
    const allServerTools = mcpConnectionManager.getAllTools();

    for (const [serverName, { tools: serializedTools }] of allServerTools) {
      this.registerServerTools(serverName, serializedTools);
    }
  }

  /**
   * 注册单个服务器的工具
   */
  private registerServerTools(serverName: string, serializedTools: any[]): void {
    if (!serializedTools || serializedTools.length === 0) {
      return;
    }

    const server = mcpConnectionManager.getServer(serverName);
    if (!server || server.type !== 'connected') {
      return;
    }

    const client = (server as any).client;

    for (const toolData of serializedTools) {
      const wrapper = new McpToolWrapper(
        serverName,
        toolData,
        () => {
          const srv = mcpConnectionManager.getServer(serverName);
          if (srv && srv.type === 'connected') {
            return (srv as any).client;
          }
          return undefined;
        }
      );

      this.registeredMcpTools.set(wrapper.name, wrapper);
      toolManager.registerTool(wrapper);
    }

    logger.info(`Registered ${serializedTools.length} tools from MCP server: ${serverName}`);
  }

  /**
   * 刷新所有MCP工具
   * 重新从已连接服务器获取工具列表并更新注册表
   */
  async refreshAllTools(): Promise<number> {
    logger.info('Refreshing all MCP tools');

    this.unregisterAllTools();

    await this.syncTools();

    logger.info(`MCP tools refreshed: ${this.registeredMcpTools.size} tools registered`);
    return this.registeredMcpTools.size;
  }

  /**
   * 从ToolManager注销所有MCP工具
   */
  private unregisterAllTools(): void {
    for (const [name] of this.registeredMcpTools) {
      toolManager.unregisterTool(name);
    }
    this.registeredMcpTools.clear();
  }

  /**
   * 获取已注册的MCP工具数量
   */
  getRegisteredCount(): number {
    return this.registeredMcpTools.size;
  }

  /**
   * 获取所有已注册的MCP工具
   */
  getRegisteredTools(): Tool[] {
    return Array.from(this.registeredMcpTools.values());
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 清理
   */
  async cleanup(): Promise<void> {
    this.unregisterAllTools();
    this.initialized = false;
    logger.info('MCP tool bridge cleaned up');
  }
}

export const mcpToolBridge = new MCPToolBridge();
