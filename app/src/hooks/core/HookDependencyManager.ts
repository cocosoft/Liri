/**
 * 支持Hook依赖解析、循环依赖检测、优先级排序等功能
 */

import type { HookDefinition, HookDependency, HookPriority } from '../types';

/**
 * 依赖关系节点
 */
interface DependencyNode {
  /**
   * Hook ID
   */
  hookId: string;

  /**
   * 依赖的Hook ID列表
   */
  dependencies: string[];

  /**
   * 被依赖的Hook ID列表
   */
  dependents: string[];

  /**
   * Hook优先级
   */
  priority: HookPriority;

  /**
   * 是否已解析
   */
  resolved: boolean;

  /**
   * 是否正在解析（用于循环依赖检测）
   */
  resolving: boolean;
}

/**
 * 依赖解析结果
 */
interface DependencyResolutionResult {
  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 解析后的Hook ID列表（按执行顺序）
   */
  executionOrder?: string[];

  /**
   * 错误信息
   */
  error?: string;

  /**
   * 循环依赖路径（如果存在）
   */
  cyclePath?: string[];

  /**
   * 缺失的依赖项
   */
  missingDependencies?: string[];
}

export class HookDependencyManager {
  private dependencyGraph: Map<string, DependencyNode> = new Map();
  private hookDefinitions: Map<string, HookDefinition> = new Map();

  /**
   * 添加Hook定义
   */
  addHookDefinition(hook: HookDefinition): void {
    const hookId = this.generateHookId(hook);
    this.hookDefinitions.set(hookId, hook);

    // 创建依赖节点
    const dependencies = hook.dependencies?.map((dep) => dep.hookId) || [];

    this.dependencyGraph.set(hookId, {
      hookId,
      dependencies,
      dependents: [],
      priority: hook.priority || 'normal',
      resolved: false,
      resolving: false,
    });

    // 更新依赖关系
    this.updateDependencyRelationships();
  }

  /**
   * 批量添加Hook定义
   */
  addHookDefinitions(hooks: HookDefinition[]): void {
    hooks.forEach((hook) => this.addHookDefinition(hook));
  }

  /**
   * 移除Hook定义
   */
  removeHookDefinition(hookId: string): boolean {
    if (!this.hookDefinitions.has(hookId)) {
      return false;
    }

    this.hookDefinitions.delete(hookId);
    this.dependencyGraph.delete(hookId);

    // 更新依赖关系
    this.updateDependencyRelationships();

    return true;
  }

  /**
   * 解析依赖关系
   */
  resolveDependencies(): DependencyResolutionResult {
    const executionOrder: string[] = [];
    const visited: Set<string> = new Set();
    const resolving: Set<string> = new Set();

    // 重置所有节点的状态
    this.resetNodeStates();

    // 按优先级排序的Hook列表
    const hooksByPriority = this.getHooksByPriority();

    for (const hookId of hooksByPriority) {
      if (!visited.has(hookId)) {
        const result = this.depthFirstTraversal(
          hookId,
          visited,
          resolving,
          executionOrder
        );
        if (!result.success) {
          return result;
        }
      }
    }

    return {
      success: true,
      executionOrder,
    };
  }

  /**
   * 深度优先遍历
   */
  private depthFirstTraversal(
    hookId: string,
    visited: Set<string>,
    resolving: Set<string>,
    executionOrder: string[]
  ): DependencyResolutionResult {
    const node = this.dependencyGraph.get(hookId);
    if (!node) {
      return {
        success: false,
        error: `Hook not found: ${hookId}`,
        missingDependencies: [hookId],
      };
    }

    // 检查循环依赖
    if (resolving.has(hookId)) {
      const cyclePath = Array.from(resolving);
      cyclePath.push(hookId);
      return {
        success: false,
        error: 'Circular dependency detected',
        cyclePath,
      };
    }

    // 如果已经访问过，直接返回
    if (visited.has(hookId)) {
      return { success: true, executionOrder };
    }

    // 标记为正在解析
    resolving.add(hookId);
    node.resolving = true;

    // 先处理所有依赖项
    for (const dependencyId of node.dependencies) {
      const result = this.depthFirstTraversal(
        dependencyId,
        visited,
        resolving,
        executionOrder
      );
      if (!result.success) {
        return result;
      }
    }

    // 处理当前节点
    visited.add(hookId);
    resolving.delete(hookId);
    node.resolved = true;
    node.resolving = false;
    executionOrder.push(hookId);

    return { success: true, executionOrder };
  }

  /**
   * 获取按优先级排序的Hook列表
   */
  private getHooksByPriority(): string[] {
    const priorityOrder: Record<HookPriority, number> = {
      highest: 100,
      high: 75,
      normal: 50,
      low: 25,
      lowest: 0,
    };

    return Array.from(this.dependencyGraph.keys()).sort((a, b) => {
      const nodeA = this.dependencyGraph.get(a)!;
      const nodeB = this.dependencyGraph.get(b)!;

      const priorityA = priorityOrder[nodeA.priority] || 50;
      const priorityB = priorityOrder[nodeB.priority] || 50;

      return priorityB - priorityA; // 高优先级在前
    });
  }

  /**
   * 更新依赖关系
   */
  private updateDependencyRelationships(): void {
    // 清空所有依赖关系
    for (const node of this.dependencyGraph.values()) {
      node.dependents = [];
    }

    // 重新建立依赖关系
    for (const [hookId, node] of this.dependencyGraph.entries()) {
      for (const dependencyId of node.dependencies) {
        const dependencyNode = this.dependencyGraph.get(dependencyId);
        if (dependencyNode) {
          dependencyNode.dependents.push(hookId);
        }
      }
    }
  }

  /**
   * 重置节点状态
   */
  private resetNodeStates(): void {
    for (const node of this.dependencyGraph.values()) {
      node.resolved = false;
      node.resolving = false;
    }
  }

  /**
   * 检查依赖完整性
   */
  checkDependencyIntegrity(): {
    valid: boolean;
    missingDependencies: string[];
    circularDependencies: string[][];
  } {
    const missingDependencies: string[] = [];
    const circularDependencies: string[][] = [];

    // 检查缺失的依赖项
    for (const [hookId, node] of this.dependencyGraph.entries()) {
      for (const dependencyId of node.dependencies) {
        if (!this.dependencyGraph.has(dependencyId)) {
          missingDependencies.push(`${hookId} -> ${dependencyId}`);
        }
      }
    }

    // 检查循环依赖
    const visited: Set<string> = new Set();
    const resolving: Set<string> = new Set();

    for (const hookId of this.dependencyGraph.keys()) {
      if (!visited.has(hookId)) {
        const cycle = this.detectCycle(hookId, visited, resolving, []);
        if (cycle) {
          circularDependencies.push(cycle);
        }
      }
    }

    return {
      valid:
        missingDependencies.length === 0 && circularDependencies.length === 0,
      missingDependencies,
      circularDependencies,
    };
  }

  /**
   * 检测循环依赖
   */
  private detectCycle(
    hookId: string,
    visited: Set<string>,
    resolving: Set<string>,
    path: string[]
  ): string[] | null {
    if (resolving.has(hookId)) {
      // 找到循环依赖
      const cycleStart = path.indexOf(hookId);
      return path.slice(cycleStart);
    }

    if (visited.has(hookId)) {
      return null;
    }

    visited.add(hookId);
    resolving.add(hookId);
    path.push(hookId);

    const node = this.dependencyGraph.get(hookId);
    if (node) {
      for (const dependencyId of node.dependencies) {
        const cycle = this.detectCycle(dependencyId, visited, resolving, path);
        if (cycle) {
          return cycle;
        }
      }
    }

    resolving.delete(hookId);
    path.pop();

    return null;
  }

  /**
   * 获取Hook的依赖链
   */
  getDependencyChain(hookId: string): { chain: string[]; depth: number } {
    const chain: string[] = [];
    const visited: Set<string> = new Set();

    const buildChain = (currentId: string): number => {
      if (visited.has(currentId)) {
        return 0;
      }

      visited.add(currentId);
      chain.push(currentId);

      const node = this.dependencyGraph.get(currentId);
      if (!node || node.dependencies.length === 0) {
        return 1;
      }

      let maxDepth = 0;
      for (const dependencyId of node.dependencies) {
        const depth = buildChain(dependencyId);
        maxDepth = Math.max(maxDepth, depth);
      }

      return maxDepth + 1;
    };

    const depth = buildChain(hookId);

    return { chain, depth };
  }

  /**
   * 获取受影响的Hook
   */
  getAffectedHooks(hookId: string): string[] {
    const affected: Set<string> = new Set();
    const queue: string[] = [hookId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      affected.add(currentId);

      const node = this.dependencyGraph.get(currentId);
      if (node) {
        for (const dependentId of node.dependents) {
          if (!affected.has(dependentId)) {
            queue.push(dependentId);
          }
        }
      }
    }

    return Array.from(affected);
  }

  /**
   * 可视化依赖关系
   */
  visualizeDependencies(): string {
    const lines: string[] = [];

    for (const [hookId, node] of this.dependencyGraph.entries()) {
      const hookDefinition = this.hookDefinitions.get(hookId);
      const priority = node.priority;

      lines.push(`${hookId} [${priority}]`);

      if (node.dependencies.length > 0) {
        for (const dependencyId of node.dependencies) {
          lines.push(`  -> ${dependencyId}`);
        }
      }

      if (node.dependents.length > 0) {
        lines.push(`  <- ${node.dependents.join(', ')}`);
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 生成Hook ID
   */
  private generateHookId(hook: HookDefinition): string {
    return `${hook.event}:${hook.name}:${hook.version || '1.0.0'}`;
  }

  /**
   * 获取依赖图统计信息
   */
  getStatistics(): {
    totalHooks: number;
    totalDependencies: number;
    maxDependencyDepth: number;
    averageDependenciesPerHook: number;
  } {
    const totalHooks = this.dependencyGraph.size;
    let totalDependencies = 0;
    let maxDepth = 0;

    for (const node of this.dependencyGraph.values()) {
      totalDependencies += node.dependencies.length;

      const chain = this.getDependencyChain(node.hookId);
      maxDepth = Math.max(maxDepth, chain.depth);
    }

    const averageDependencies =
      totalHooks > 0 ? totalDependencies / totalHooks : 0;

    return {
      totalHooks,
      totalDependencies,
      maxDependencyDepth: maxDepth,
      averageDependenciesPerHook: averageDependencies,
    };
  }
}

/**
 * 全局Hook依赖管理器实例
 */
export const globalHookDependencyManager = new HookDependencyManager();

export default HookDependencyManager;
