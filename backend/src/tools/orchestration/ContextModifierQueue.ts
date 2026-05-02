/**
 * 上下文修改器队列
 * 基于CC源码 cc_code/backend/services/tools/toolOrchestration.ts 实现
 * 管理工具执行后对上下文的修改
 */

import type { ContextModifier } from './types';

/**
 * 上下文修改器队列
 * 用于收集和应用工具执行后对上下文的修改
 */
export class ContextModifierQueue {
  /** 修改器映射表 */
  private modifiers: Map<string, ((context: any) => any)[]> = new Map();

  /**
   * 入队一个上下文修改器
   * @param toolUseID 工具使用ID
   * @param modifier 修改器函数
   */
  enqueue(toolUseID: string, modifier: (context: any) => any): void {
    const existing = this.modifiers.get(toolUseID) || [];
    existing.push(modifier);
    this.modifiers.set(toolUseID, existing);
  }

  /**
   * 出队并应用指定工具的所有修改器
   * @param toolUseID 工具使用ID
   * @param context 当前上下文
   * @returns 修改后的上下文
   */
  dequeueAndApply(toolUseID: string, context: any): any {
    const modifiers = this.modifiers.get(toolUseID) || [];
    let result = context;

    for (const modifier of modifiers) {
      try {
        result = modifier(result);
      } catch (error) {
        console.error(`Context modifier error for ${toolUseID}:`, error);
      }
    }

    this.modifiers.delete(toolUseID);
    return result;
  }

  /**
   * 应用所有待处理的修改器
   * @param context 当前上下文
   * @returns 修改后的上下文
   */
  applyAll(context: any): any {
    let result = context;

    for (const [toolUseID, modifiers] of this.modifiers.entries()) {
      for (const modifier of modifiers) {
        try {
          result = modifier(result);
        } catch (error) {
          console.error(`Context modifier error for ${toolUseID}:`, error);
        }
      }
    }

    this.modifiers.clear();
    return result;
  }

  /**
   * 检查是否有待处理的修改器
   * @param toolUseID 工具使用ID
   * @returns 是否有待处理的修改器
   */
  hasModifiers(toolUseID: string): boolean {
    const modifiers = this.modifiers.get(toolUseID);
    return modifiers !== undefined && modifiers.length > 0;
  }

  /**
   * 获取待处理修改器的总数
   * @returns 修改器总数
   */
  size(): number {
    let total = 0;
    for (const modifiers of this.modifiers.values()) {
      total += modifiers.length;
    }
    return total;
  }

  /**
   * 获取指定工具的修改器数量
   * @param toolUseID 工具使用ID
   * @returns 修改器数量
   */
  getModifierCount(toolUseID: string): number {
    return this.modifiers.get(toolUseID)?.length || 0;
  }

  /**
   * 清除所有修改器
   */
  clear(): void {
    this.modifiers.clear();
  }

  /**
   * 获取所有有待处理修改器的工具ID列表
   * @returns 工具ID列表
   */
  getPendingToolIDs(): string[] {
    return Array.from(this.modifiers.keys());
  }

  /**
   * 移除指定工具的所有修改器
   * @param toolUseID 工具使用ID
   * @returns 是否成功移除
   */
  remove(toolUseID: string): boolean {
    return this.modifiers.delete(toolUseID);
  }
}

/**
 * 创建上下文修改器队列实例
 * @returns 上下文修改器队列实例
 */
export function createContextModifierQueue(): ContextModifierQueue {
  return new ContextModifierQueue();
}
