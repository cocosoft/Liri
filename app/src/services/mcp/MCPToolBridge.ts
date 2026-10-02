//
/**
 * MCP工具桥接器
 * 将MCP服务器的工具注册到主ToolManager中
 */

import { getLogger } from '@modules/monitoring';
import {
  handleError,
  AppError,
  ErrorCategory,
  ErrorSeverity,
} from '@modules/error';

const logger = getLogger('services:mcp:toolBridge');
// 2026-10-01 B18-a：**删除** `import { getToolManager } from '@modules/tools'` ——
// 它构成 `services(mcp) -> tools(app)` 倒挂。注册/注销改经**注入的工具端口**（见 McpToolRegistrationPort），
// 由组合根 `modules/ModuleDefinitions.ts`（**app 层**，`modules -> tools` 同层合法）在 initialize() 时传入。
import { mcpToolRegistry } from './MCPToolRegistry';
import { McpToolWrapper } from './McpToolWrapper';
import { mcpConnectionManager } from './MCPConnectionManager';
// 2026-10-01 D-208（子批 E，`services -> context` 倒挂收口）：`dependencyRegistry` 早在
// **D-157 即已下沉** `core/DependencyRegistry.ts`（`context/` 仅转出）⇒ 原 `@modules/context`
// 取用属倒挂。改**相对直连 core 模块根**（同 D-157 先例 `PermissionInterceptor.ts:40`）。
import { dependencyRegistry } from '../../core/DependencyRegistry.js';
// 2026-10-01 B18-b：工具契约已下沉 `src/utils/toolContract/`（utils/infra 层）⇒ 改指新落点。
import type { Tool } from '@modules/utils/toolContract';

/**
 * 2026-10-01 B18-a：工具注册**端口**。
 *
 * 由**组合根**注入（`modules/ModuleDefinitions.ts`，app 层 ⇒ `modules -> tools` 同层合法，
 * 见 `scripts/modules-to-layers.json`），使本文件（service 层）**不再静态依赖** `@modules/tools`(app)。
 * 注入与初始化是**同一次调用** ⇒ 无启动时序风险（规避 C1/C2 级问题）。
 */
export interface McpToolRegistrationPort {
  registerTool: (tool: Tool) => void;
  unregisterTool: (name: string) => void;
}

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

  /** 2026-10-01 B18-a：组合根注入的工具注册端口（null = 未注入）。 */
  private toolPort: McpToolRegistrationPort | null = null;

  /**
   * 初始化桥接器
   * 将当前已连接的MCP服务器工具注册到ToolManager
   *
   * ⚠️ `toolPort` **必填**：由组合根（`modules/ModuleDefinitions.ts`）在调用链最外层构造并传入，
   * 与初始化同一次调用完成 ⇒ 不存在"用了才注入"的时序窗口。
   */
  async initialize(toolPort: McpToolRegistrationPort): Promise<void> {
    this.toolPort = toolPort;
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
   * 取工具端口。未注入即使用属**编程错误**（组合根必注入）⇒ 依 CS03 **不做静默回退**，明确抛错。
   */
  private requireToolPort(): McpToolRegistrationPort {
    if (!this.toolPort) {
      throw new AppError(
        'MCPToolBridge 未注入工具端口：须由组合根（modules/ModuleDefinitions.ts）在 initialize() 时传入',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }
    return this.toolPort;
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
      this.requireToolPort().registerTool(wrapper);

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
          this.requireToolPort().unregisterTool(name);
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
