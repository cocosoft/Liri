/**
 * 循环依赖检测器
 * 使用 DFS 检测服务依赖图中是否存在环，并提供拓扑排序
 */
import type { ServiceDescriptor, CycleDetectionResult } from './types';

export class CycleDetector {
  /**
   * 检测依赖图中是否存在循环依赖
   * 可选依赖（optionalDependencies）不参与循环检测
   */
  detect(descriptors: Map<string, ServiceDescriptor>): CycleDetectionResult {
    const cycle = this.findCycle(descriptors, [...descriptors.keys()]);
    return cycle ? { hasCycle: true, cycle } : { hasCycle: false };
  }

  /**
   * 增量检测：只从 `startId` 出发找环（评审 #5：注册期全图 DFS 是 O(N²)；
   * 原图无环时新环必过新节点 ⇒ 单点 DFS 与全图检测等价）。
   */
  detectFrom(
    descriptors: Map<string, ServiceDescriptor>,
    startId: string
  ): CycleDetectionResult {
    if (!descriptors.has(startId)) return { hasCycle: false };
    const cycle = this.findCycle(descriptors, [startId]);
    return cycle ? { hasCycle: true, cycle } : { hasCycle: false };
  }

  /** DFS 找环；返回**闭环**（评审 #2：原实现丢弃 cycle、返回「根→环入口」前缀路径） */
  private findCycle(
    descriptors: Map<string, ServiceDescriptor>,
    roots: readonly string[]
  ): string[] | null {
    const adjacency = new Map<string, string[]>();
    for (const [id, desc] of descriptors) {
      adjacency.set(id, desc.dependencies ?? []);
    }

    const visited = new Set<string>();
    const visiting = new Set<string>();
    const path: string[] = [];
    let found: string[] | null = null;

    const dfs = (node: string): boolean => {
      if (visiting.has(node)) {
        const cycleStart = path.indexOf(node);
        found = [...path.slice(cycleStart === -1 ? 0 : cycleStart), node];
        return true;
      }
      if (visited.has(node)) return false;

      visiting.add(node);
      path.push(node);

      for (const dep of adjacency.get(node) ?? []) {
        if (dfs(dep)) return true;
      }

      visiting.delete(node);
      path.pop();
      visited.add(node);
      return false;
    };

    for (const root of roots) {
      if (!visited.has(root) && dfs(root)) break;
    }

    return found;
  }

  /**
   * 拓扑排序
   * 可选依赖（optionalDependencies）在排序中跳过未注册的依赖
   */
  topologicalSort(descriptors: Map<string, ServiceDescriptor>): string[] {
    const visited = new Set<string>();
    const result: string[] = [];

    const dfs = (node: string): void => {
      if (visited.has(node)) return;
      visited.add(node);

      const desc = descriptors.get(node);
      if (desc) {
        // 必选依赖全部参与排序，缺失时仍尝试排序
        for (const dep of desc.dependencies ?? []) {
          dfs(dep);
        }

        // 可选依赖：仅当已注册时才参与排序，未注册的跳过
        for (const dep of desc.optionalDependencies ?? []) {
          if (descriptors.has(dep)) {
            dfs(dep);
          }
        }
      }

      result.push(node);
    };

    for (const id of descriptors.keys()) {
      dfs(id);
    }

    return result;
  }

  /**
   * 查找依赖指定服务的所有服务（反向依赖查询）
   */
  findDependents(
    descriptors: Map<string, ServiceDescriptor>,
    targetId: string
  ): string[] {
    const dependents: string[] = [];

    for (const [id, desc] of descriptors) {
      const deps = desc.dependencies ?? [];
      if (deps.includes(targetId)) {
        dependents.push(id);
      }
      // 可选依赖也计入反向引用
      const optDeps = desc.optionalDependencies ?? [];
      if (optDeps.includes(targetId)) {
        if (!dependents.includes(id)) {
          dependents.push(id);
        }
      }
    }

    return dependents;
  }
}
