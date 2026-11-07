/**
 * 工具执行优化器
 * 负责工具执行的并行化、错误处理和超时控制
 */

import { Tool } from './types/Tool';
import { ToolResult, createToolResult } from './types/ToolResult';
import { ToolUseContext } from './types/ToolUseContext';
import { ToolExecutor, createToolExecutor } from './ToolExecutor';
import { ParallelExecutor } from './executor/ParallelExecutor';
import { v4 as uuidv4 } from 'uuid';

import { getLogger } from '@openliri/infra/monitoring';
const logger = getLogger('tools:ToolExecutionOptimizer');

/**
 * 工具执行优化器选项
 */
export interface ToolExecutionOptimizerOptions {
  /** 最大并行执行数 */
  maxParallelExecutions?: number;
  /** 默认超时时间（毫秒） */
  defaultTimeout?: number;
  /** 工具执行器 */
  toolExecutor?: ToolExecutor;
}

/**
 * 工具执行优化器
 *
 * ⚠️ 2026-11-07：本类原有的结果缓存（`executeWithCache`，按 `tool.name + JSON(input)` 缓存 5 分钟）
 * **已整条移除**，与 `utils/OptimizedToolManagerUtils` 的同类缺陷同批修复：
 * 有副作用的工具（`bash` / `file_write` / `code_run` …）命中缓存 == 「以为跑了其实没跑」
 * （真机实测同一 `ver` 第二次 4ms 返回、`bash:` 日志一条没有）；即便只读工具，结果也会随外部状态过期。
 * 本类当前**全仓未接线**；后续启用时**不得**再引入工具结果缓存。
 */
export class ToolExecutionOptimizer {
  /** 工具执行器 */
  private toolExecutor: ToolExecutor;
  /** 最大并行执行数 */
  private maxParallelExecutions: number;
  /** 默认超时时间 */
  private defaultTimeout: number;
  /** 当前并行执行数 */
  private currentParallelExecutions: number = 0;
  /** 执行队列 */
  private executionQueue: Array<() => Promise<void>> = [];

  /**
   * 构造函数
   */
  constructor(options: ToolExecutionOptimizerOptions = {}) {
    this.toolExecutor = options.toolExecutor || createToolExecutor();
    this.maxParallelExecutions = options.maxParallelExecutions || 5;
    this.defaultTimeout = options.defaultTimeout || 30 * 1000; // 30秒
  }

  /**
   * 执行工具（带超时控制）
   */
  async executeWithTimeout(
    tool: Tool,
    input: Record<string, unknown>,
    context: ToolUseContext,
    onProgress?: (progress: any) => void,
    timeout: number = this.defaultTimeout
  ): Promise<ToolResult> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Tool execution timed out after ${timeout}ms`));
      }, timeout);

      this.executeToolWithQueue(tool, input, context, onProgress)
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * 执行工具（带队列控制）
   */
  private async executeToolWithQueue(
    tool: Tool,
    input: Record<string, unknown>,
    context: ToolUseContext,
    onProgress?: (progress: any) => void
  ): Promise<ToolResult> {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        try {
          this.currentParallelExecutions++;
          const result = await this.toolExecutor.execute(
            tool,
            input,
            context,
            onProgress
          );
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.currentParallelExecutions--;
          this.processQueue();
        }
      };

      if (this.currentParallelExecutions < this.maxParallelExecutions) {
        execute();
      } else {
        this.executionQueue.push(execute);
      }
    });
  }

  /**
   * 并行执行多个工具
   */
  async executeParallel(
    tools: Array<{
      tool: Tool;
      input: Record<string, unknown>;
    }>,
    context: ToolUseContext,
    options?: {
      timeout?: number;
      onProgress?: (toolName: string, progress: any) => void;
    }
  ): Promise<Map<string, ToolResult>> {
    const parallelExecutor = new ParallelExecutor({
      maxConcurrency: this.maxParallelExecutions,
      defaultTimeout: options?.timeout || this.defaultTimeout,
    });

    const tasks = tools.map(({ tool, input }) => ({
      execute: () =>
        this.executeWithTimeout(
          tool,
          input,
          context,
          options?.onProgress
            ? (progress) => options.onProgress!(tool.name, progress)
            : undefined,
          options?.timeout
        ),
    }));

    const taskResults = await parallelExecutor.execute<ToolResult>(tasks);
    const results = new Map<string, ToolResult>();

    for (let i = 0; i < tools.length; i++) {
      const taskResult = taskResults.find((r) => r.index === i);
      if (taskResult?.data) {
        results.set(tools[i].tool.name, taskResult.data);
      } else {
        results.set(
          tools[i].tool.name,
          createToolResult(null, {
            newMessages: [
              {
                role: 'system',
                content: `Error: ${taskResult?.error?.message || 'Unknown error'}`,
              },
            ],
          })
        );
      }
    }

    return results;
  }

  /**
   * 处理执行队列
   */
  private processQueue(): void {
    while (
      this.executionQueue.length > 0 &&
      this.currentParallelExecutions < this.maxParallelExecutions
    ) {
      const execute = this.executionQueue.shift();
      if (execute) {
        execute();
      }
    }
  }

  /**
   * 设置最大并行执行数
   */
  setMaxParallelExecutions(max: number): void {
    this.maxParallelExecutions = max;
    // 处理队列
    this.processQueue();
  }

  /**
   * 设置默认超时时间
   */
  setDefaultTimeout(timeout: number): void {
    this.defaultTimeout = timeout;
  }

  /**
   * 获取工具执行器
   */
  getToolExecutor(): ToolExecutor {
    return this.toolExecutor;
  }

  /**
   * 设置工具执行器
   */
  setToolExecutor(executor: ToolExecutor): void {
    this.toolExecutor = executor;
  }

  /**
   * 获取当前并行执行数
   */
  getCurrentParallelExecutions(): number {
    return this.currentParallelExecutions;
  }

  /**
   * 获取队列长度
   */
  getQueueLength(): number {
    return this.executionQueue.length;
  }

  /**
   * 按依赖图拓扑排序执行并行工具
   * 同层工具并行执行，不同层按拓扑顺序串行
   */
  async executeParallelWithDeps(
    tools: Array<{
      tool: Tool;
      input: Record<string, unknown>;
    }>,
    context: ToolUseContext,
    dependencyGraph: ToolDependencyGraph,
    options?: {
      timeout?: number;
      onProgress?: (toolName: string, progress: any) => void;
    }
  ): Promise<Map<string, ToolResult>> {
    const toolNames = tools.map((t) => t.tool.name);
    const levels = dependencyGraph.topologicalSort(toolNames);
    const nameToTool = new Map(tools.map((t) => [t.tool.name, t]));
    const results = new Map<string, ToolResult>();

    for (const level of levels) {
      if (level.length === 0) continue;

      const levelTools = level
        .map((name) => nameToTool.get(name))
        .filter((t): t is NonNullable<typeof t> => t !== undefined);

      if (levelTools.length === 0) continue;

      const levelResults = await this.executeParallel(
        levelTools,
        context,
        options
      );

      for (const [name, result] of levelResults) {
        results.set(name, result);
      }
    }

    return results;
  }
}

/**
 * 工具依赖关系
 */
export interface ToolDependency {
  toolName: string;
  dependsOn: string[];
}

/**
 * 工具依赖图：DAG 拓扑排序
 * 使用 Kahn 算法实现，用于确定工具执行的先后顺序
 */
export class ToolDependencyGraph {
  /** 有向边: toolName -> {它依赖的工具} */
  private graph: Map<string, Set<string>> = new Map();
  /** 反向边: toolName -> {依赖它的工具} */
  private dependents: Map<string, Set<string>> = new Map();

  addDependency(toolName: string, dependsOn: string[]): void {
    if (!this.graph.has(toolName)) {
      this.graph.set(toolName, new Set());
    }
    if (!this.dependents.has(toolName)) {
      this.dependents.set(toolName, new Set());
    }

    for (const dep of dependsOn) {
      if (dep === toolName) continue;
      this.graph.get(toolName)!.add(dep);
      if (!this.dependents.has(dep)) {
        this.dependents.set(dep, new Set());
      }
      this.dependents.get(dep)!.add(toolName);
    }
  }

  removeDependency(toolName: string): void {
    this.graph.delete(toolName);
    this.dependents.delete(toolName);
    for (const [, deps] of this.graph) {
      deps.delete(toolName);
    }
    for (const [, deps] of this.dependents) {
      deps.delete(toolName);
    }
  }

  getDependencies(toolName: string): string[] {
    return Array.from(this.graph.get(toolName) ?? []);
  }

  getDependents(toolName: string): string[] {
    return Array.from(this.dependents.get(toolName) ?? []);
  }

  clear(): void {
    this.graph.clear();
    this.dependents.clear();
  }

  /**
   * Kahn 算法拓扑排序
   * 返回分层结果：每层是可并行执行的工具，层间按依赖顺序串行
   */
  topologicalSort(toolNames: string[]): string[][] {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, Set<string>>();

    for (const name of toolNames) {
      inDegree.set(name, 0);
      adj.set(name, new Set());
    }

    for (const name of toolNames) {
      const deps = this.graph.get(name);
      if (!deps) continue;
      for (const dep of deps) {
        if (!toolNames.includes(dep)) continue;
        const depSet = adj.get(dep);
        if (depSet) {
          depSet.add(name);
          inDegree.set(name, (inDegree.get(name) || 0) + 1);
        }
      }
    }

    const levels: string[][] = [];
    let queue: string[] = [];

    for (const name of toolNames) {
      if ((inDegree.get(name) || 0) === 0) {
        queue.push(name);
      }
    }

    while (queue.length > 0) {
      levels.push([...queue]);
      const nextQueue: string[] = [];

      for (const node of queue) {
        const neighbors = adj.get(node);
        if (!neighbors) continue;
        for (const neighbor of neighbors) {
          const currentDegree = inDegree.get(neighbor) || 0;
          const newDegree = currentDegree - 1;
          inDegree.set(neighbor, newDegree);
          if (newDegree === 0) {
            nextQueue.push(neighbor);
          }
        }
      }

      queue = nextQueue;
    }

    const sortedAll = levels.flat();
    const remaining = toolNames.filter((n) => !sortedAll.includes(n));
    if (remaining.length > 0) {
      levels.push(remaining);
    }

    return levels;
  }

  /**
   * 检测是否有循环依赖
   */
  hasCyclicDependency(): boolean {
    const allNodes = new Set([...this.graph.keys(), ...this.dependents.keys()]);
    const WHITE = 0,
      GRAY = 1,
      BLACK = 2;
    const color = new Map<string, number>();

    for (const node of allNodes) {
      color.set(node, WHITE);
    }

    const dfs = (node: string): boolean => {
      color.set(node, GRAY);
      const deps = this.graph.get(node);
      if (deps) {
        for (const neighbor of deps) {
          const c = color.get(neighbor);
          if (c === GRAY) return true;
          if (c === WHITE) {
            if (dfs(neighbor)) return true;
          }
        }
      }
      color.set(node, BLACK);
      return false;
    };

    for (const node of allNodes) {
      if (color.get(node) === WHITE) {
        if (dfs(node)) return true;
      }
    }

    return false;
  }
}

/**
 * 创建工具执行优化器实例
 */
export function createToolExecutionOptimizer(
  options?: ToolExecutionOptimizerOptions
): ToolExecutionOptimizer {
  return new ToolExecutionOptimizer(options);
}

/**
 * 全局工具执行优化器实例
 */
let globalOptimizer: ToolExecutionOptimizer | null = null;

/**
 * 获取全局工具执行优化器
 */
export function getToolExecutionOptimizer(): ToolExecutionOptimizer {
  if (!globalOptimizer) {
    globalOptimizer = createToolExecutionOptimizer();
  }
  return globalOptimizer;
}
