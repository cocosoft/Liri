/**
 * 工具分组
 * 按域组织工具集，支持按需激活
 * 对标 AgentScope ToolGroup (_tool_group.py)
 */

import { BaseTool } from './BaseTool';
import type { ToolParam, ToolUseContext, ToolCallProgress, ToolResult, ToolProgressData } from './types';

/**
 * 工具分组
 * 将一组相关工具组织在一起，便于管理和按域激活
 */
export class ToolGroup {
  /** 组名 */
  readonly name: string;

  /** 组描述 */
  readonly description: string;

  private readonly tools: Map<string, BaseTool<any, any>> = new Map();

  constructor(name: string, description: string) {
    this.name = name;
    this.description = description;
  }

  /**
   * 注册单个工具到组
   */
  register<T extends BaseTool<any, any>>(tool: T): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * 批量注册工具到组
   */
  registerAll(tools: BaseTool<any, any>[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * 按名称获取组内工具
   */
  get(name: string): BaseTool<any, any> | undefined {
    return this.tools.get(name);
  }

  /**
   * 列出组内所有工具
   */
  list(): BaseTool<any, any>[] {
    return Array.from(this.tools.values());
  }

  /**
   * 获取工具数量
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * 检查是否包含指定工具
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 从组中移除工具
   */
  remove(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * 生成组信息的简要描述
   */
  toSummary(): { name: string; description: string; toolCount: number; toolNames: string[] } {
    return {
      name: this.name,
      description: this.description,
      toolCount: this.tools.size,
      toolNames: Array.from(this.tools.keys()),
    };
  }
}
