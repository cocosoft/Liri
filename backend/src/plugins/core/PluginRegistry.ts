/**
 * 插件注册器（基于CC源码实现）
 * 负责插件的注册、注销、查询和依赖管理
 */

import { EventEmitter } from 'events';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import {
  PluginRegistration,
  PluginState,
  PluginDependencyResolution,
  PluginEventType,
  PluginEvent,
} from '../types/PluginTypes';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 插件注册器（基于CC源码）
 */
export class PluginRegistry extends EventEmitter {
  private registry: Map<string, PluginRegistration> = new Map();
  private dependencyGraph: Map<string, Set<string>> = new Map();

  /**
   * 注册插件（基于CC源码）
   */
  registerPlugin(registration: PluginRegistration): void {
    const existing = this.registry.get(registration.id);

    if (existing) {
      throw new AppError(
        `Plugin already registered: ${registration.id}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 添加插件到注册表
    this.registry.set(registration.id, registration);

    // 初始化依赖图
    this.dependencyGraph.set(registration.id, new Set());

    // 添加依赖关系
    for (const dependency of registration.dependencies) {
      this.addDependency(registration.id, dependency);
    }

    this.emitPluginEvent(PluginEventType.AFTER_LOAD, registration.id);

    logger.info(`✅ Plugin registered: ${registration.id}`);
  }

  /**
   * 注销插件（基于CC源码）
   */
  unregisterPlugin(pluginId: string): boolean {
    const registration = this.registry.get(pluginId);

    if (!registration) {
      return false;
    }

    // 检查是否有插件依赖此插件
    const dependents = this.getDependents(pluginId);

    if (dependents.length > 0) {
      throw new AppError(
        `Cannot unregister plugin ${pluginId} because it has dependents: ${dependents.join(', ')}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 移除依赖关系
    for (const dependency of registration.dependencies) {
      this.removeDependency(pluginId, dependency);
    }

    // 从注册表中移除
    this.registry.delete(pluginId);
    this.dependencyGraph.delete(pluginId);

    this.emitPluginEvent(PluginEventType.AFTER_UNLOAD, pluginId);

    logger.info(`✅ Plugin unregistered: ${pluginId}`);

    return true;
  }

  /**
   * 获取插件注册信息（基于CC源码）
   */
  getPlugin(pluginId: string): PluginRegistration | undefined {
    return this.registry.get(pluginId);
  }

  /**
   * 获取所有插件（基于CC源码）
   */
  getAllPlugins(): PluginRegistration[] {
    return Array.from(this.registry.values());
  }

  /**
   * 获取已启用插件（基于CC源码）
   */
  getEnabledPlugins(): PluginRegistration[] {
    return Array.from(this.registry.values()).filter(
      (plugin) => plugin.enabled
    );
  }

  /**
   * 获取插件数量（基于CC源码）
   */
  getPluginCount(): number {
    return this.registry.size;
  }

  /**
   * 启用插件（基于CC源码）
   */
  enablePlugin(pluginId: string): boolean {
    const registration = this.registry.get(pluginId);

    if (!registration) {
      return false;
    }

    if (registration.enabled) {
      return true; // 已经启用
    }

    registration.enabled = true;
    registration.lastLoadedAt = new Date();

    this.emitPluginEvent(PluginEventType.STATE_CHANGED, pluginId, {
      oldState: PluginState.DISABLED,
      newState: PluginState.ENABLED,
    });

    logger.info(`✅ Plugin enabled: ${pluginId}`);

    return true;
  }

  /**
   * 禁用插件（基于CC源码）
   */
  disablePlugin(pluginId: string): boolean {
    const registration = this.registry.get(pluginId);

    if (!registration) {
      return false;
    }

    if (!registration.enabled) {
      return true; // 已经禁用
    }

    registration.enabled = false;

    this.emitPluginEvent(PluginEventType.STATE_CHANGED, pluginId, {
      oldState: PluginState.ENABLED,
      newState: PluginState.DISABLED,
    });

    logger.info(`✅ Plugin disabled: ${pluginId}`);

    return true;
  }

  /**
   * 添加依赖关系（基于CC源码）
   */
  addDependency(pluginId: string, dependencyId: string): void {
    if (!this.registry.has(pluginId)) {
      throw new AppError(
        `Plugin not found: ${pluginId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    if (!this.registry.has(dependencyId)) {
      throw new AppError(
        `Dependency plugin not found: ${dependencyId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const dependencies = this.dependencyGraph.get(pluginId);

    if (dependencies) {
      dependencies.add(dependencyId);
    }

    // 更新被依赖关系
    const dependentRegistration = this.registry.get(dependencyId);
    if (dependentRegistration) {
      dependentRegistration.dependents.push(pluginId);
    }

    logger.info(`✅ Dependency added: ${pluginId} -> ${dependencyId}`);
  }

  /**
   * 移除依赖关系（基于CC源码）
   */
  removeDependency(pluginId: string, dependencyId: string): void {
    const dependencies = this.dependencyGraph.get(pluginId);

    if (dependencies) {
      dependencies.delete(dependencyId);
    }

    // 更新被依赖关系
    const dependentRegistration = this.registry.get(dependencyId);
    if (dependentRegistration) {
      const index = dependentRegistration.dependents.indexOf(pluginId);
      if (index !== -1) {
        dependentRegistration.dependents.splice(index, 1);
      }
    }

    logger.info(`✅ Dependency removed: ${pluginId} -> ${dependencyId}`);
  }

  /**
   * 获取依赖关系（基于CC源码）
   */
  getDependencies(pluginId: string): string[] {
    const dependencies = this.dependencyGraph.get(pluginId);

    if (!dependencies) {
      return [];
    }

    return Array.from(dependencies);
  }

  /**
   * 获取被依赖关系（基于CC源码）
   */
  getDependents(pluginId: string): string[] {
    const registration = this.registry.get(pluginId);

    if (!registration) {
      return [];
    }

    return registration.dependents;
  }

  /**
   * 解析依赖关系（基于CC源码）
   */
  resolveDependencies(pluginId: string): PluginDependencyResolution {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const dependencyChain: string[] = [];
    const missingDependencies: string[] = [];
    const circularDependencies: string[][] = [];

    const result = this.dfsResolveDependencies(
      pluginId,
      visited,
      visiting,
      dependencyChain,
      missingDependencies,
      circularDependencies
    );

    return {
      success:
        result &&
        missingDependencies.length === 0 &&
        circularDependencies.length === 0,
      dependencyChain,
      missingDependencies,
      circularDependencies,
      error: !result ? 'Dependency resolution failed' : undefined,
    };
  }

  /**
   * 深度优先搜索解析依赖（基于CC源码）
   */
  private dfsResolveDependencies(
    pluginId: string,
    visited: Set<string>,
    visiting: Set<string>,
    dependencyChain: string[],
    missingDependencies: string[],
    circularDependencies: string[][]
  ): boolean {
    if (visited.has(pluginId)) {
      return true; // 已经访问过
    }

    if (visiting.has(pluginId)) {
      // 检测到循环依赖
      const cycle = Array.from(visiting).concat(pluginId);
      circularDependencies.push(cycle);
      return false;
    }

    visiting.add(pluginId);

    // 检查插件是否存在
    if (!this.registry.has(pluginId)) {
      missingDependencies.push(pluginId);
      visiting.delete(pluginId);
      return false;
    }

    // 解析依赖
    const dependencies = this.getDependencies(pluginId);
    let allDependenciesResolved = true;

    for (const dependency of dependencies) {
      const resolved = this.dfsResolveDependencies(
        dependency,
        visited,
        visiting,
        dependencyChain,
        missingDependencies,
        circularDependencies
      );

      if (!resolved) {
        allDependenciesResolved = false;
      }
    }

    visiting.delete(pluginId);
    visited.add(pluginId);

    if (allDependenciesResolved) {
      dependencyChain.push(pluginId);
    }

    return allDependenciesResolved;
  }

  /**
   * 拓扑排序（基于CC源码）
   */
  topologicalSort(): string[] {
    const visited = new Set<string>();
    const result: string[] = [];

    for (const pluginId of this.registry.keys()) {
      if (!visited.has(pluginId)) {
        this.dfsTopologicalSort(pluginId, visited, new Set<string>(), result);
      }
    }

    return result.reverse();
  }

  /**
   * 深度优先搜索拓扑排序（基于CC源码）
   */
  private dfsTopologicalSort(
    pluginId: string,
    visited: Set<string>,
    visiting: Set<string>,
    result: string[]
  ): void {
    if (visited.has(pluginId)) {
      return;
    }

    if (visiting.has(pluginId)) {
      throw new AppError(
        `Circular dependency detected: ${Array.from(visiting).concat(pluginId).join(' -> ')}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    visiting.add(pluginId);

    // 处理依赖
    const dependencies = this.getDependencies(pluginId);

    for (const dependency of dependencies) {
      this.dfsTopologicalSort(dependency, visited, visiting, result);
    }

    visiting.delete(pluginId);
    visited.add(pluginId);

    result.push(pluginId);
  }

  /**
   * 检查循环依赖（基于CC源码）
   */
  checkCircularDependencies(): string[][] {
    const visited = new Set<string>();
    const circularDependencies: string[][] = [];

    for (const pluginId of this.registry.keys()) {
      if (!visited.has(pluginId)) {
        this.dfsCheckCircularDependencies(
          pluginId,
          visited,
          new Set<string>(),
          [],
          circularDependencies
        );
      }
    }

    return circularDependencies;
  }

  /**
   * 深度优先搜索检查循环依赖（基于CC源码）
   */
  private dfsCheckCircularDependencies(
    pluginId: string,
    visited: Set<string>,
    visiting: Set<string>,
    path: string[],
    circularDependencies: string[][]
  ): void {
    if (visited.has(pluginId)) {
      return;
    }

    if (visiting.has(pluginId)) {
      // 检测到循环依赖
      const cycleStartIndex = path.indexOf(pluginId);
      if (cycleStartIndex !== -1) {
        const cycle = path.slice(cycleStartIndex).concat(pluginId);
        circularDependencies.push(cycle);
      }
      return;
    }

    visiting.add(pluginId);
    path.push(pluginId);

    // 检查依赖
    const dependencies = this.getDependencies(pluginId);

    for (const dependency of dependencies) {
      this.dfsCheckCircularDependencies(
        dependency,
        visited,
        visiting,
        path,
        circularDependencies
      );
    }

    visiting.delete(pluginId);
    path.pop();
    visited.add(pluginId);
  }

  /**
   * 发射插件事件（基于CC源码）
   */
  private emitPluginEvent(
    type: PluginEventType,
    pluginId: string,
    data?: any
  ): void {
    const event: PluginEvent = {
      type,
      pluginId,
      data,
      timestamp: new Date(),
    };

    this.emit('pluginEvent', event);
    this.emit(type, event);
  }

  /**
   * 清理注册器（基于CC源码）
   */
  clear(): void {
    this.registry.clear();
    this.dependencyGraph.clear();

    logger.info('✅ Plugin registry cleared');
  }
}

export default PluginRegistry;
