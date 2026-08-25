/**
 * 负责插件的注册、注销、查询和依赖管理
 * 支持回退加载机制（§5 向后兼容性保障 — 措施3）
 */

import { EventEmitter } from 'events';
import { getLogger } from '@modules/monitoring';
import {
  PluginRegistration,
  PluginState,
  PluginDependencyResolution,
  PluginEventType,
  PluginEvent,
} from '../types/PluginTypes';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const logger = getLogger('plugins:core:pluginRegistry');

/**
 * 回退加载器类型
 * 当 getPlugin() 直接查找失败时，回调此函数尝试从其他来源加载并生成注册信息
 */
export type FallbackPluginLoader = (
  pluginId: string
) => PluginRegistration | undefined;

/**
 * 插件注册器
 */
export class PluginRegistry extends EventEmitter {
  private registry: Map<string, PluginRegistration> = new Map();
  private dependencyGraph: Map<string, Set<string>> = new Map();
  private fallbackLoader: FallbackPluginLoader | null = null;

  /**
   * 注册插件
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
   * 注销插件
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
   * 设置回退加载器（§5 措施3）
   * 当 getPlugin() 直接查找失败时，自动从回退加载器获取并注册
   * @param fallback 回退加载函数
   */
  setFallback(fallback: FallbackPluginLoader): void {
    this.fallbackLoader = fallback;
  }

  /**
   * 清除回退加载器
   */
  clearFallback(): void {
    this.fallbackLoader = null;
  }

  /**
   * 获取插件注册信息
   * 优先从注册表查找；如果未找到，调用回退加载器自动加载并注册
   * 回退加载的插件依赖图初始为空（不在 bundle 中记录依赖信息）
   */
  getPlugin(pluginId: string): PluginRegistration | undefined {
    const existing = this.registry.get(pluginId);
    if (existing) return existing;

    if (this.fallbackLoader) {
      const fallbackRegistration = this.fallbackLoader(pluginId);
      if (fallbackRegistration) {
        this.registerPlugin(fallbackRegistration);
        return fallbackRegistration;
      }
    }

    return undefined;
  }

  /**
   * 获取所有插件
   */
  getAllPlugins(): PluginRegistration[] {
    return Array.from(this.registry.values());
  }

  /**
   * 获取已启用插件
   */
  getEnabledPlugins(): PluginRegistration[] {
    return Array.from(this.registry.values()).filter(
      (plugin) => plugin.enabled
    );
  }

  /**
   * 获取已启用插件（短名别名）
   */
  getEnabled(): PluginRegistration[] {
    return this.getEnabledPlugins();
  }

  /**
   * 获取已禁用插件
   */
  getDisabled(): PluginRegistration[] {
    return Array.from(this.registry.values()).filter(
      (plugin) => !plugin.enabled
    );
  }

  /**
   * 获取已禁用插件（完整风格别名）
   */
  getDisabledPlugins(): PluginRegistration[] {
    return this.getDisabled();
  }

  /**
   * 获取插件数量
   */
  getPluginCount(): number {
    return this.registry.size;
  }

  /**
   * 启用插件
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
   * 禁用插件
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
   * 添加依赖关系
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
   * 移除依赖关系
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
   * 获取依赖关系
   */
  getDependencies(pluginId: string): string[] {
    const dependencies = this.dependencyGraph.get(pluginId);

    if (!dependencies) {
      return [];
    }

    return Array.from(dependencies);
  }

  /**
   * 获取被依赖关系
   */
  getDependents(pluginId: string): string[] {
    const registration = this.registry.get(pluginId);

    if (!registration) {
      return [];
    }

    return registration.dependents;
  }

  /**
   * 发射插件事件
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
   * 清理注册器
   */
  clear(): void {
    this.registry.clear();
    this.dependencyGraph.clear();

    logger.info('✅ Plugin registry cleared');
  }
}

export default PluginRegistry;
