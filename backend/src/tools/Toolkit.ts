/**
 * 工具包管理器
 * 管理多个工具组的注册和按需激活
 * 对标 AgentScope Toolkit (_toolkit.py)
 */

import { BaseTool } from './BaseTool';
import { ToolGroup } from './ToolGroup';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const TOOLKIT_MODULE = 'Toolkit';

/**
 * 工具包 — 组合多个工具组
 * 管理组注册、激活、查询等生命周期
 */
export class Toolkit {
  private readonly groups: Map<string, ToolGroup> = new Map();

  private readonly activatedGroups: Set<string> = new Set();

  /**
   * 注册工具组
   */
  registerGroup(group: ToolGroup): void {
    if (this.groups.has(group.name)) {
      throw new AppError(
        `工具组已存在: ${group.name}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        undefined,
        { module: TOOLKIT_MODULE, context: { groupName: group.name } }
      );
    }
    this.groups.set(group.name, group);
  }

  /**
   * 取消注册工具组
   */
  unregisterGroup(name: string): boolean {
    this.activatedGroups.delete(name);
    return this.groups.delete(name);
  }

  /**
   * 激活工具组（组内工具变为模型可见）
   */
  activateGroup(name: string): void {
    if (!this.groups.has(name)) {
      throw new AppError(
        `工具组不存在: ${name}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        undefined,
        { module: TOOLKIT_MODULE, context: { groupName: name } }
      );
    }
    this.activatedGroups.add(name);
  }

  /**
   * 停用工具组
   */
  deactivateGroup(name: string): void {
    this.activatedGroups.delete(name);
  }

  /**
   * 检查工具组是否已激活
   */
  isGroupActivated(name: string): boolean {
    return this.activatedGroups.has(name);
  }

  /**
   * 获取所有已注册的工具组
   */
  listGroups(): ToolGroup[] {
    return Array.from(this.groups.values());
  }

  /**
   * 获取所有已激活的工具
   * 遍历所有已激活组，返回其中所有工具
   */
  getActivatedTools(): BaseTool<any, any>[] {
    const tools: BaseTool<any, any>[] = [];
    for (const groupName of this.activatedGroups) {
      const group = this.groups.get(groupName);
      if (group) {
        tools.push(...group.list());
      }
    }
    return tools;
  }

  /**
   * 按名称查找工具（在所有已激活组中查找）
   */
  findTool(name: string): BaseTool<any, any> | undefined {
    for (const groupName of this.activatedGroups) {
      const group = this.groups.get(groupName);
      if (group && group.has(name)) {
        return group.get(name);
      }
    }
    return undefined;
  }

  /**
   * 获取所有已激活的工具组摘要信息
   */
  getActivatedGroupSummaries(): Array<{ name: string; description: string; toolCount: number; toolNames: string[] }> {
    const summaries: Array<{ name: string; description: string; toolCount: number; toolNames: string[] }> = [];
    for (const groupName of this.activatedGroups) {
      const group = this.groups.get(groupName);
      if (group) {
        summaries.push(group.toSummary());
      }
    }
    return summaries;
  }

  /**
   * 获取所有已注册工具组的数量
   */
  get groupCount(): number {
    return this.groups.size;
  }

  /**
   * 获取已激活工具组的数量
   */
  get activatedCount(): number {
    return this.activatedGroups.size;
  }

  /**
   * 重置：停用所有组
   */
  deactivateAll(): void {
    this.activatedGroups.clear();
  }

  /**
   * 完全清理：移除所有组
   */
  clear(): void {
    this.activatedGroups.clear();
    this.groups.clear();
  }
}
