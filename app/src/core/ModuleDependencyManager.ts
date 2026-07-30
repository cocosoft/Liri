/**
 * 模块依赖管理系统
 *
 * @deprecated 由 ModuleRegistry + DIContainer 替代。保留用于 --use-legacy-module-system 回退路径。
 * 负责管理模块的依赖关系、加载顺序和循环依赖检测
 */

import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'ModuleDependencyManager' });
import {
  TerminalComponents,
  type TableColumn,
  type TableRow,
} from '@modules/ui/TerminalComponents.js';
import chalk from 'chalk';

/**
 * 获取徽章文本
 */
function getBadgeText(text: string, color: string): string {
  const colorMap: Record<string, typeof chalk> = {
    green: chalk.green,
    gray: chalk.gray,
    blue: chalk.blue,
    red: chalk.red,
    yellow: chalk.yellow,
  };
  const styler = colorMap[color] || chalk.white;
  return styler(` ${text} `);
}

/**
 * 模块定义
 */
export interface ModuleDefinition {
  name: string;
  version: string;
  description?: string;
  dependencies?: string[];
  optionalDependencies?: string[];
  init?: () => Promise<void> | void;
  destroy?: () => Promise<void> | void;
  priority?: number;
}

/**
 * 模块状态
 */
export enum ModuleStatus {
  UNLOADED = 'unloaded',
  LOADING = 'loading',
  LOADED = 'loaded',
  INITIALIZING = 'initializing',
  READY = 'ready',
  ERROR = 'error',
}

/**
 * 模块实例
 */
export interface ModuleInstance {
  definition: ModuleDefinition;
  status: ModuleStatus;
  error?: string;
  loadTime?: number;
  initTime?: number;
}

/**
 * 依赖图节点
 */
interface DependencyNode {
  module: string;
  dependencies: string[];
  visited: boolean;
  visiting: boolean;
  level: number;
}

/**
 * 模块依赖管理器
 *
 * @deprecated 请使用 modules/ModuleRegistry 替代。
 * ModuleRegistry 提供了统一的模块注册、依赖解析、生命周期管理
 * 和 DI 容器集成（useContainer(getDIContainer())）。
 * 此文件将在未来版本中移除。
 */
export class ModuleDependencyManager {
  private modules: Map<string, ModuleInstance> = new Map();
  private dependencyGraph: Map<string, DependencyNode> = new Map();
  private initOrder: string[] = [];

  constructor() {
    process.emitWarning(
      'ModuleDependencyManager 已废弃，由 ModuleRegistry + DIContainer 替代。' +
        '请使用 getDIContainer() 进行服务注册与获取。',
      'DeprecationWarning'
    );
  }

  /**
   * 注册模块
   */
  registerModule(definition: ModuleDefinition): void {
    if (this.modules.has(definition.name)) {
      logger.warn(`Module ${definition.name} is already registered, skipping`);
      return;
    }

    const instance: ModuleInstance = {
      definition,
      status: ModuleStatus.UNLOADED,
    };

    this.modules.set(definition.name, instance);

    // 构建依赖图
    this.dependencyGraph.set(definition.name, {
      module: definition.name,
      dependencies: definition.dependencies || [],
      visited: false,
      visiting: false,
      level: 0,
    });

    logger.info(`Registered module: ${definition.name} v${definition.version}`);
  }

  /**
   * 注销模块
   */
  async unregisterModule(name: string): Promise<void> {
    const instance = this.modules.get(name);
    if (!instance) {
      logger.warn(`Module ${name} not found`);
      return;
    }

    // 检查是否有其他模块依赖此模块
    const dependents = this.getDependents(name);
    if (dependents.length > 0) {
      throw new AppError(
        `Cannot unregister module ${name}, it is required by: ${dependents.join(', ')}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }

    // 执行销毁函数
    if (instance.definition.destroy) {
      try {
        await instance.definition.destroy();
      } catch (error) {
        await handleError(error, {
          module: 'core:deprecated',
          action: 'destroy',
        });
      }
    }

    this.modules.delete(name);
    this.dependencyGraph.delete(name);

    logger.info(`Unregistered module: ${name}`);
  }

  /**
   * 检测循环依赖
   */
  detectCircularDependencies(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();

    for (const [name, node] of this.dependencyGraph) {
      if (!visited.has(name)) {
        const cycle = this.findCycle(name, new Set<string>());
        if (cycle.length > 0) {
          cycles.push(cycle);
          // 标记循环中的所有节点为已访问
          for (const moduleName of cycle) {
            visited.add(moduleName);
          }
        }
      }
    }

    return cycles;
  }

  /**
   * 查找从指定节点开始的循环
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
   * 计算模块加载顺序
   */
  calculateLoadOrder(): string[] {
    const order: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

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
        for (const dep of node.dependencies) {
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

    // 按优先级排序
    const sortedModules = Array.from(this.modules.values()).sort((a, b) => {
      const priorityA = a.definition.priority || 0;
      const priorityB = b.definition.priority || 0;
      return priorityB - priorityA;
    });

    for (const instance of sortedModules) {
      if (!visited.has(instance.definition.name)) {
        visit(instance.definition.name);
      }
    }

    this.initOrder = order;
    return order;
  }

  /**
   * 初始化所有模块
   */
  async initializeAll(): Promise<void> {
    const cycles = this.detectCircularDependencies();
    if (cycles.length > 0) {
      throw new AppError(
        `Circular dependencies detected: ${cycles.map((c) => c.join(' -> ')).join(', ')}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH
      );
    }

    const order = this.calculateLoadOrder();

    TerminalComponents.printHeader('模块初始化');
    TerminalComponents.printInfo(
      `发现 ${order.length} 个模块，按依赖顺序初始化...`
    );

    const steps = order.map((name) => ({
      title: name,
      status: 'pending' as 'pending' | 'completed' | 'error',
    }));

    TerminalComponents.printSteps(steps);

    for (let i = 0; i < order.length; i++) {
      const name = order[i];
      const instance = this.modules.get(name);

      if (!instance) {
        continue;
      }

      try {
        instance.status = ModuleStatus.INITIALIZING;
        const startTime = Date.now();

        if (instance.definition.init) {
          await instance.definition.init();
        }

        instance.initTime = Date.now() - startTime;
        instance.status = ModuleStatus.READY;

        steps[i].status = 'completed';
        logger.info(`Initialized module: ${name} (${instance.initTime}ms)`);
      } catch (error) {
        instance.status = ModuleStatus.ERROR;
        instance.error = error instanceof Error ? error.message : String(error);
        steps[i].status = 'error';
        await handleError(error, {
          module: 'core:deprecated',
          action: 'init',
        });

        // 检查是否是可选依赖
        const isOptional = this.isOptionalDependency(name);
        if (!isOptional) {
          throw error;
        }
      }
    }

    TerminalComponents.printSteps(steps);
    TerminalComponents.printSuccess(`成功初始化 ${order.length} 个模块`);
  }

  /**
   * 获取模块状态
   */
  getModuleStatus(name: string): ModuleStatus | undefined {
    return this.modules.get(name)?.status;
  }

  /**
   * 获取所有模块状态
   */
  getAllModuleStatus(): Array<{
    name: string;
    status: ModuleStatus;
    error?: string;
  }> {
    return Array.from(this.modules.entries()).map(([name, instance]) => ({
      name,
      status: instance.status,
      error: instance.error,
    }));
  }

  /**
   * 获取模块列表
   */
  getModules(): ModuleInstance[] {
    return Array.from(this.modules.values());
  }

  /**
   * 获取模块
   */
  getModule(name: string): ModuleInstance | undefined {
    return this.modules.get(name);
  }

  /**
   * 检查模块是否已注册
   */
  hasModule(name: string): boolean {
    return this.modules.has(name);
  }

  /**
   * 获取依赖此模块的模块列表
   */
  getDependents(name: string): string[] {
    const dependents: string[] = [];

    for (const [moduleName, node] of this.dependencyGraph) {
      if (node.dependencies.includes(name)) {
        dependents.push(moduleName);
      }
    }

    return dependents;
  }

  /**
   * 获取模块的依赖列表
   */
  getDependencies(name: string): string[] {
    return this.dependencyGraph.get(name)?.dependencies || [];
  }

  /**
   * 检查是否是可选依赖
   */
  private isOptionalDependency(name: string): boolean {
    const instance = this.modules.get(name);
    if (!instance) {
      return false;
    }

    // 检查是否有其他模块将其作为可选依赖
    for (const [moduleName, node] of this.dependencyGraph) {
      const otherModule = this.modules.get(moduleName);
      if (
        otherModule?.definition.optionalDependencies?.includes(name) &&
        node.dependencies.includes(name)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * 显示模块依赖树
   */
  showDependencyTree(): void {
    TerminalComponents.printHeader('模块依赖树');

    const tree: Array<[string, string]> = [];

    for (const [name, node] of this.dependencyGraph) {
      if (node.dependencies.length === 0) {
        tree.push([name, '无依赖']);
      } else {
        tree.push([name, node.dependencies.join(', ')]);
      }
    }

    TerminalComponents.printKeyValue(tree);
  }

  /**
   * 显示模块状态概览
   */
  showModuleOverview(): void {
    TerminalComponents.printHeader('模块状态概览');

    const status = this.getAllModuleStatus();
    const ready = status.filter((s) => s.status === ModuleStatus.READY).length;
    const error = status.filter((s) => s.status === ModuleStatus.ERROR).length;
    const loading = status.filter(
      (s) =>
        s.status === ModuleStatus.LOADING ||
        s.status === ModuleStatus.INITIALIZING
    ).length;

    TerminalComponents.printKeyValue([
      ['总模块数', status.length.toString()],
      ['就绪', ready.toString()],
      ['加载中', loading.toString()],
      ['错误', error.toString()],
    ]);

    if (status.length > 0) {
      const rows = status.map((s) => {
        const statusColor =
          s.status === ModuleStatus.READY
            ? 'green'
            : s.status === ModuleStatus.ERROR
              ? 'red'
              : 'yellow';
        return [s.name, getBadgeText(s.status, statusColor), s.error || '-'];
      });

      TerminalComponents.printTable(
        ['模块', '状态', '错误'].map((h) => ({ header: h, width: 15 })),
        rows.map((r) => ({ cells: r }))
      );
    }
  }
}

/**
 * 创建模块依赖管理器
 *
 * @deprecated 请使用 modules/ModuleRegistry 替代。
 */
export function createModuleDependencyManager(): ModuleDependencyManager {
  return new ModuleDependencyManager();
}
