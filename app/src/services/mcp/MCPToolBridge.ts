//
/**
 * MCP工具桥接器
 * 将MCP服务器的工具注册到主ToolManager中
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('services:mcp:toolBridge');
import { getToolManager } from '@modules/tools';
import { mcpToolRegistry } from './MCPToolRegistry';
import { McpToolWrapper } from './McpToolWrapper';
import { mcpConnectionManager } from './MCPConnectionManager';
import { dependencyRegistry } from '@modules/context';
import type { Tool } from '@modules/tools/types/Tool';

/**
 * MCP工具桥接器
 * 负责将MCP服务器的工具映射为Tool接口实例并注册到ToolManager
 */
export class MCPToolBridge {
  private registeredMcpTools: Map<string, Tool> = new Map();
  /** T2.1-MCP（§3.1 关联点2）：已广播工具集变更的服务器集合（用于注销时 withdraw） */
  private registeredServers: Set<string> = new Set();
  /** W5：服务器级注册 disposer 列表（对齐 skill/plugin EffectScope，注销按 LIFO 逆序执行） */
  private disposers: Array<() => void> = [];
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
      logger.info(
        `MCP tool bridge initialized: ${this.registeredMcpTools.size} tools registered`
      );
    } catch (error) {
      await handleError(error, {
        module: 'services:mcp:bridge',
        action: 'initialize',
      });
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
   * @returns disposer：注销该服务器的全部工具（逆序清理，对齐 EffectScope）
   */
  private registerServerTools(
    serverName: string,
    serializedTools: any[]
  ): () => void {
    if (!serializedTools || serializedTools.length === 0) {
      return () => {};
    }

    const server = mcpConnectionManager.getServer(serverName);
    if (!server || server.type !== 'connected') {
      return () => {};
    }

    const client = (server as any).client;
    const names: string[] = [];

    for (const toolData of serializedTools) {
      const wrapper = new McpToolWrapper(serverName, toolData, () => {
        const srv = mcpConnectionManager.getServer(serverName);
        if (srv && srv.type === 'connected') {
          return (srv as any).client;
        }
        return undefined;
      });

      names.push(wrapper.name);
      this.registeredMcpTools.set(wrapper.name, wrapper);
      getToolManager().registerTool(wrapper);

      // 同步注册到 MCPToolRegistry（增强层缓存）
      mcpToolRegistry.registerTool(
        serverName,
        wrapper.name,
        wrapper.description,
        (toolData as any).inputJSONSchema || {},
        wrapper
      );
    }

    logger.info(
      `Registered ${serializedTools.length} tools from MCP server: ${serverName}`
    );

    // T2.1-MCP（§3.1 关联点2）：服务器工具集变更经 DependencyRegistry 广播
    // （与 T2.2 模型热切换同"重激活"模式），消费者 subscribe(`mcp:tools:${serverName}`) 感知
    this.registeredServers.add(serverName);
    dependencyRegistry.provide(
      `mcp:tools:${serverName}`,
      serializedTools.map((t) => (t as { name: string }).name)
    );

    const disposer = (): void => {
      for (const name of names) {
        const wrapper = this.registeredMcpTools.get(name);
        if (wrapper) {
          getToolManager().unregisterTool(name);
          this.registeredMcpTools.delete(name);
        }
      }
      mcpToolRegistry.unregisterServer(serverName);
      dependencyRegistry.withdraw(`mcp:tools:${serverName}`);
      this.registeredServers.delete(serverName);
    };
    this.disposers.push(disposer);
    return disposer;
  }

  /**
   * 刷新所有MCP工具
   * 重新从已连接服务器获取工具列表并更新注册表
   */
  async refreshAllTools(): Promise<number> {
    logger.info('Refreshing all MCP tools');

    this.unregisterAllTools();

    await this.syncTools();

    logger.info(
      `MCP tools refreshed: ${this.registeredMcpTools.size} tools registered`
    );
    return this.registeredMcpTools.size;
  }

  /**
   * 从ToolManager注销所有MCP工具（逆序执行注册 disposer，LIFO 对齐 EffectScope）
   */
  private unregisterAllTools(): void {
    while (this.disposers.length > 0) {
      const disposer = this.disposers.pop();
      disposer?.();
    }
    this.registeredMcpTools.clear();
    this.registeredServers.clear();
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
