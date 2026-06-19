/**
 * 增强版模块依赖管理系统
 *
 * @deprecated 由 ModuleRegistry + DIContainer 替代。保留用于 --use-legacy-module-system 回退路径。
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { Logger } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ module: 'EnhancedModuleDependencyManager' });

/**
 * 增强版模块定义
 */
export interface EnhancedModuleDefinition {
  name: string;
  version: string;
  description?: string;
  dependencies?: string[];
  optionalDependencies?: string[];
  init?: () => Promise<void> | void;
  destroy?: () => Promise<void> | void;
  priority?: number;

  // 新增字段
  preload?: boolean; // 是否支持预加载
  parallelizable?: boolean; // 是否可并行加载
  resourceRequirements?: ResourceRequirements; // 资源需求
}

/**
 * 资源需求定义
 */
export interface ResourceRequirements {
  memory?: number; // 内存需求（MB）
  cpu?: number; // CPU需求（百分比）
  network?: boolean; // 是否需要网络
  disk?: boolean; // 是否需要磁盘IO
}

/**
 * 增强版模块状态
 */
export enum EnhancedModuleStatus {
  UNLOADED = 'unloaded',
  PRELOADING = 'preloading',
  LOADING = 'loading',
  LOADED = 'loaded',
  INITIALIZING = 'initializing',
  READY = 'ready',
  ERROR = 'error',
}

/**
 * 增强版模块实例
 */
export interface EnhancedModuleInstance {
  definition: EnhancedModuleDefinition;
  status: EnhancedModuleStatus;
  error?: string;
  loadTime?: number;
  initTime?: number;
  dependencies: string[];
  dependents: string[];
  resourceUsage: ResourceUsage;
}

/**
 * 资源使用情况
 */
export interface ResourceUsage {
  memory: number;
  cpu: number;
  network: number;
  disk: number;
}

/**
 * 依赖图节点（增强版）
 */
interface EnhancedDependencyNode {
  module: string;
  dependencies: string[];
  optionalDependencies: string[];
  dependents: string[];
  visited: boolean;
  visiting: boolean;
  level: number;
  priority: number;
  preload: boolean;
  parallelizable: boolean;
}

/**
 * 依赖分析结果
 */
export interface DependencyAnalysis {
  loadOrder: string[];
  parallelGroups: string[][];
  criticalPath: string[];
  cycleDetection: CycleDetectionResult;
  optimizationSuggestions: OptimizationSuggestion[];
}

/**
 * 循环依赖检测结果
 */
export interface CycleDetectionResult {
  hasCycles: boolean;
  cycles: string[][];
  criticalCycles: string[][];
}

/**
 * 优化建议
 */
export interface OptimizationSuggestion {
  type: 'parallel' | 'preload' | 'dependency' | 'resource';
  module: string;
  suggestion: string;
  impact: 'high' | 'medium' | 'low';
}

/**
 * 增强版模块依赖管理器
 *
 * @deprecated 请使用 modules/ModuleRegistry 替代。
 * ModuleRegistry 提供了统一的模块注册、依赖解析、生命周期管理
 * 和 DI 容器集成（useContainer(getDIContainer())）。
 * 此文件将在未来版本中移除。
 */
export class EnhancedModuleDependencyManager {
  private modules: Map<string, EnhancedModuleInstance> = new Map();
  private dependencyGraph: Map<string, EnhancedDependencyNode> = new Map();
  private initOrder: string[] = [];
  private performanceMetrics: Map<string, PerformanceMetrics> = new Map();
  private resourcePool: ResourcePool;

  constructor() {
    this.resourcePool = new ResourcePool();
  }

  /**
   * 注册模块（增强版）
   */
  registerModule(definition: EnhancedModuleDefinition): void {
    if (this.modules.has(definition.name)) {
      logger.warn(`Module ${definition.name} is already registered, skipping`);
      return;
    }

    const instance: EnhancedModuleInstance = {
      definition,
      status: EnhancedModuleStatus.UNLOADED,
      dependencies: definition.dependencies || [],
      dependents: [],
      resourceUsage: {
        memory: 0,
        cpu: 0,
        network: 0,
        disk: 0,
      },
    };

    this.modules.set(definition.name, instance);

    // 构建增强版依赖图
    this.dependencyGraph.set(definition.name, {
      module: definition.name,
      dependencies: definition.dependencies || [],
      optionalDependencies: definition.optionalDependencies || [],
      dependents: [],
      visited: false,
      visiting: false,
      level: 0,
      priority: definition.priority || 0,
      preload: definition.preload || false,
      parallelizable: definition.parallelizable || true,
    });

    // 更新依赖关系
    this.updateDependencies();

    logger.info(
      `Registered enhanced module: ${definition.name} v${definition.version}`
    );
  }

  /**
   * 更新依赖关系
   */
  private updateDependencies(): void {
    // 重置所有节点的依赖关系
    for (const node of this.dependencyGraph.values()) {
      node.dependents = [];
    }

    // 重新构建依赖关系
    for (const [name, node] of this.dependencyGraph) {
      for (const dep of node.dependencies) {
        const depNode = this.dependencyGraph.get(dep);
        if (depNode) {
          depNode.dependents.push(name);
        }
      }
    }
  }

  /**
   * 高级依赖分析
   */
  analyzeDependencies(): DependencyAnalysis {
    const loadOrder = this.calculateOptimizedLoadOrder();
    const parallelGroups = this.identifyParallelGroups();
    const criticalPath = this.findCriticalPath();
    const cycleDetection = this.detectCircularDependencies();
    const optimizationSuggestions = this.generateOptimizationSuggestions();

    return {
      loadOrder,
      parallelGroups,
      criticalPath,
      cycleDetection,
      optimizationSuggestions,
    };
  }

  /**
   * 计算优化后的加载顺序
   */
  private calculateOptimizedLoadOrder(): string[] {
    const order: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    // 拓扑排序算法（增强版）
    const visit = (name: string): void => {
      if (visited.has(name)) {
        return;
      }

      if (visiting.has(name)) {
        throw new AppError(
          `Circular dependency detected involving module: ${name}`,
          ErrorCategory.VALIDATION,
          ErrorSeverity.HIGH
        );
      }

      visiting.add(name);

      const node = this.dependencyGraph.get(name);
      if (node) {
        // 按优先级排序依赖
        const sortedDeps = this.sortDependenciesByPriority(node.dependencies);

        for (const dep of sortedDeps) {
          if (this.modules.has(dep)) {
            visit(dep);
          } else {
            logger.warn(
              `Dependency ${dep} of module ${name} is not registered`
            );
          }
        }
      }

      visiting.delete(name);
      visited.add(name);
      order.push(name);
    };

    // 按优先级排序所有模块
    const sortedModules = Array.from(this.dependencyGraph.keys()).sort(
      (a, b) => {
        const nodeA = this.dependencyGraph.get(a)!;
        const nodeB = this.dependencyGraph.get(b)!;
        return nodeB.priority - nodeA.priority;
      }
    );

    for (const name of sortedModules) {
      if (!visited.has(name)) {
        visit(name);
      }
    }

    return order;
  }

  /**
   * 按优先级排序依赖
   */
  private sortDependenciesByPriority(dependencies: string[]): string[] {
    return dependencies.sort((a, b) => {
      const nodeA = this.dependencyGraph.get(a);
      const nodeB = this.dependencyGraph.get(b);

      if (!nodeA || !nodeB) {
        return 0;
      }

      return nodeB.priority - nodeA.priority;
    });
  }

  /**
   * 识别可并行加载的模块组
   */
  private identifyParallelGroups(): string[][] {
    const groups: string[][] = [];
    const visited = new Set<string>();
    const loadOrder = this.calculateOptimizedLoadOrder();

    for (const moduleName of loadOrder) {
      if (visited.has(moduleName)) {
        continue;
      }

      const node = this.dependencyGraph.get(moduleName);
      if (!node || !node.parallelizable) {
        visited.add(moduleName);
        groups.push([moduleName]);
        continue;
      }

      // 查找可并行加载的模块组
      const group = this.findParallelGroup(moduleName, visited);
      if (group.length > 0) {
        groups.push(group);
      }
    }

    return groups;
  }

  /**
   * 查找可并行加载的模块组
   */
  private findParallelGroup(start: string, visited: Set<string>): string[] {
    const group: string[] = [];
    const queue: string[] = [start];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) {
        continue;
      }

      const node = this.dependencyGraph.get(current);
      if (!node || !node.parallelizable) {
        continue;
      }

      visited.add(current);
      group.push(current);

      // 添加可并行加载的依赖
      for (const dep of node.dependencies) {
        const depNode = this.dependencyGraph.get(dep);
        if (depNode && depNode.parallelizable && !visited.has(dep)) {
          queue.push(dep);
        }
      }
    }

    return group;
  }

  /**
   * 查找关键路径
   */
  private findCriticalPath(): string[] {
    // 实现关键路径算法（CPM）
    // 这里简化实现，返回依赖最深的路径
    const depths = new Map<string, number>();

    const calculateDepth = (name: string): number => {
      if (depths.has(name)) {
        return depths.get(name)!;
      }

      const node = this.dependencyGraph.get(name);
      if (!node || node.dependencies.length === 0) {
        depths.set(name, 0);
        return 0;
      }

      const depDepths = node.dependencies.map((dep) => calculateDepth(dep));
      const maxDepth = Math.max(...depDepths) + 1;
      depths.set(name, maxDepth);

      return maxDepth;
    };

    let maxDepth = -1;
    let criticalPath: string[] = [];

    for (const name of this.dependencyGraph.keys()) {
      const depth = calculateDepth(name);
      if (depth > maxDepth) {
        maxDepth = depth;
        criticalPath = this.buildPathFromDepth(name, depths);
      }
    }

    return criticalPath;
  }

  /**
   * 根据深度构建路径
   */
  private buildPathFromDepth(
    start: string,
    depths: Map<string, number>
  ): string[] {
    const path: string[] = [start];
    let current = start;

    while (true) {
      const node = this.dependencyGraph.get(current);
      if (!node || node.dependencies.length === 0) {
        break;
      }

      // 找到深度最大的依赖
      let nextDep = '';
      let maxDepth = -1;

      for (const dep of node.dependencies) {
        const depth = depths.get(dep) || 0;
        if (depth > maxDepth) {
          maxDepth = depth;
          nextDep = dep;
        }
      }

      if (nextDep && maxDepth > 0) {
        path.push(nextDep);
        current = nextDep;
      } else {
        break;
      }
    }

    return path.reverse();
  }

  /**
   * 检测循环依赖（增强版）
   */
  private detectCircularDependencies(): CycleDetectionResult {
    const cycles: string[][] = [];
    const criticalCycles: string[][] = [];
    const visited = new Set<string>();

    for (const [name, node] of this.dependencyGraph) {
      if (!visited.has(name)) {
        const cycle = this.findCycle(name, new Set<string>());
        if (cycle.length > 0) {
          cycles.push(cycle);

          // 判断是否为关键循环（涉及核心模块）
          if (this.isCriticalCycle(cycle)) {
            criticalCycles.push(cycle);
          }

          // 标记循环中的所有节点为已访问
          for (const moduleName of cycle) {
            visited.add(moduleName);
          }
        }
      }
    }

    return {
      hasCycles: cycles.length > 0,
      cycles,
      criticalCycles,
    };
  }

  /**
   * 判断是否为关键循环
   */
  private isCriticalCycle(cycle: string[]): boolean {
    const criticalModules = ['core', 'infrastructure', 'ai', 'agent'];
    return cycle.some((module) => criticalModules.includes(module));
  }

  /**
   * 查找循环依赖
   */
  private findCycle(start: string, path: Set<string>): string[] {
    if (path.has(start)) {
      // 发现循环
      return [start];
    }

    const node = this.dependencyGraph.get(start);
    if (!node) {
      return [];
    }

    path.add(start);

    for (const dep of node.dependencies) {
      const cycle = this.findCycle(dep, new Set(path));
      if (cycle.length > 0) {
        return [start, ...cycle];
      }
    }

    return [];
  }

  /**
   * 生成优化建议
   */
  private generateOptimizationSuggestions(): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    // 避免循环调用：直接使用依赖图数据而不是调用analyzeDependencies
    const loadOrder = this.calculateOptimizedLoadOrder();
    const parallelGroups = this.identifyParallelGroups();
    const cycleDetection = this.detectCircularDependencies();

    // 并行优化建议
    for (const group of parallelGroups) {
      if (group.length > 1) {
        suggestions.push({
          type: 'parallel',
          module: group[0],
          suggestion: `模块 ${group.join(', ')} 可以并行加载`,
          impact: 'high',
        });
      }
    }

    // 预加载建议
    for (const [name, node] of this.dependencyGraph) {
      if (!node.preload && this.shouldPreload(name)) {
        suggestions.push({
          type: 'preload',
          module: name,
          suggestion: `模块 ${name} 建议启用预加载`,
          impact: 'medium',
        });
      }
    }

    // 依赖优化建议
    for (const cycle of cycleDetection.cycles) {
      suggestions.push({
        type: 'dependency',
        module: cycle[0],
        suggestion: `检测到循环依赖: ${cycle.join(' -> ')}`,
        impact: 'high',
      });
    }

    return suggestions;
  }

  /**
   * 判断模块是否应该预加载
   */
  private shouldPreload(moduleName: string): boolean {
    const node = this.dependencyGraph.get(moduleName);
    if (!node) return false;

    // 核心模块或依赖较多的模块建议预加载
    return node.dependents.length > 3 || node.priority > 5;
  }

  /**
   * 并行加载模块
   */
  async loadModulesInParallel(modules: string[]): Promise<LoadResult[]> {
    const results: LoadResult[] = [];

    // 分组并行加载
    const groups = this.identifyParallelGroups();

    for (const group of groups) {
      const groupModules = group.filter((module) => modules.includes(module));
      if (groupModules.length === 0) continue;

      const groupResults = await Promise.allSettled(
        groupModules.map((module) => this.loadModule(module))
      );

      groupResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push({
            module: groupModules[index],
            success: true,
            duration: result.value.duration,
          });
        } else {
          results.push({
            module: groupModules[index],
            success: false,
            error: result.reason,
          });
        }
      });
    }

    return results;
  }

  /**
   * 加载单个模块
   */
  private async loadModule(moduleName: string): Promise<{ duration: number }> {
    const startTime = Date.now();
    const instance = this.modules.get(moduleName);

    if (!instance) {
      throw new AppError(
        `Module ${moduleName} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }

    try {
      instance.status = EnhancedModuleStatus.LOADING;

      // 模拟加载过程
      await new Promise((resolve) => setTimeout(resolve, 100));

      instance.status = EnhancedModuleStatus.LOADED;
      instance.loadTime = Date.now() - startTime;

      return { duration: instance.loadTime };
    } catch (error) {
      instance.status = EnhancedModuleStatus.ERROR;
      instance.error = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }
}

/**
 * 加载结果
 */
export interface LoadResult {
  module: string;
  success: boolean;
  duration?: number;
  error?: string;
}

/**
 * 性能指标
 */
interface PerformanceMetrics {
  loadTime: number;
  initTime: number;
  memoryUsage: number;
  cpuUsage: number;
}

/**
 * 资源池（简化实现）
 */
class ResourcePool {
  private availableMemory: number = 1024; // 1GB
  private availableCPU: number = 100; // 100%

  allocateResources(requirements: ResourceRequirements): boolean {
    // 简化实现：总是返回true
    return true;
  }

  releaseResources(usage: ResourceUsage): void {
    // 简化实现：不做实际释放
  }
}
