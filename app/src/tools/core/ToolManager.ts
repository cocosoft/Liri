/**
 * 工具管理器 — CC 兼容层
 *
 * 基于 EnhancedToolManager 实例，添加 CC 风格的 getTools() / getTool() 方法，
 * 返回 ToolRegistration[] / ToolRegistration | undefined，
 * 与 CoreAPIImpl 等 CC 消费者兼容。
 */

import {
  ToolManager as EnhancedToolManager,
  type ToolManagerOptions,
} from '../ToolManager';
import type { ToolRegistration } from '../types/ToolTypes';
import type { Tool } from '../types/Tool';
import type { ToolDefinition, ToolImplementation } from '../types/ToolTypes';

export type { ToolManagerOptions } from '../ToolManager';

export class ToolManager {
  private inner: EnhancedToolManager;

  constructor(options?: ToolManagerOptions) {
    this.inner = new EnhancedToolManager(options);
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

export const globalToolManager = new ToolManager();
