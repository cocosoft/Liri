/**
 * 工具管理器 — CC 兼容层
 *
 * 基于 EnhancedToolManager 实例，添加 CC 风格的 getTools() / getTool() 方法，
 * 返回 ToolRegistration[] / ToolRegistration | undefined，
 * 与 CoreAPIImpl 等 CC 消费者兼容。
 */

import {
  ToolManager as EnhancedToolManager,
  getToolManager,
  type ToolManagerOptions,
} from '../ToolManager';
import type { ToolRegistration } from '../types/ToolTypes';
import type { Tool } from '../types/Tool';
import type { ToolDefinition, ToolImplementation } from '../types/ToolTypes';

export type { ToolManagerOptions } from '../ToolManager';

export class ToolManager {
  private inner: EnhancedToolManager;

  constructor(options?: ToolManagerOptions) {
    // 复用主单例（getToolManager），确保与 MCPToolBridge 等消费方共享同一注册表
    void options;
    this.inner = getToolManager();
  }

  getInner(): EnhancedToolManager {
    return this.inner;
  }

  async initialize(): Promise<void> {
    return this.inner.initialize();
  }

  async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    context?: Record<string, unknown>,
    onProgress?: unknown
  ): Promise<unknown> {
    return this.inner.executeTool(toolName, input, context, onProgress);
  }

  registerTool(tool: Tool): void {
    this.inner.registerTool(tool);
  }

  /** N-6：注销工具（模块销毁时释放已注册工具，防止重复注册） */
  unregisterTool(toolName: string): boolean {
    return this.inner.unregisterTool(toolName);
  }

  getTools(): ToolRegistration[] {
    const tools = this.inner.getAllTools();
    return tools.map((t) => this.inner.toToolRegistration(t));
  }

  getTool(name: string): ToolRegistration | undefined {
    const tools = this.inner.getAllTools();
    const tool = tools.find((t) => t.name === name);
    if (!tool) return undefined;
    return this.inner.toToolRegistration(tool);
  }

  getAllTools(): Tool[] {
    return this.inner.getAllTools();
  }

  getStatus(): ReturnType<EnhancedToolManager['getStatus']> {
    return this.inner.getStatus();
  }

  enableTool(toolName: string): void {
    this.inner.enableTool(toolName);
  }

  disableTool(toolName: string): void {
    this.inner.disableTool(toolName);
  }

  registerDefinition(
    definition: ToolDefinition,
    implementation: ToolImplementation
  ): void {
    this.inner.registerDefinition(definition, implementation);
  }
}

// 惰性初始化：顶层 new ToolManager() 会在构造期触发 StartupProfiler 的
// DETAILED_PROFILING TDZ（循环导入）。首次访问时才实例化。
let _globalToolManager: ToolManager | undefined;
function getGlobalToolManager(): ToolManager {
  _globalToolManager ??= new ToolManager();
  return _globalToolManager;
}
export const globalToolManager = new Proxy({} as ToolManager, {
  get(_, prop: keyof ToolManager) {
    const instance = getGlobalToolManager();
    const value = instance[prop];
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  },
});
