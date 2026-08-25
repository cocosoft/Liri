/**
 * KernelServiceRegistry — 内核服务注册表
 * 采用服务定位器模式（非 DI 容器），提供对内核服务的统一访问入口
 * 支持按服务名称注册、按名称获取、检查所有注册服务
 * 支持基于插件 ID 的访问控制（白名单模式）
 * 4.4：继承 EventEmitter，register() 发射 serviceRegistered 事件，供响应式加载订阅
 */

import { EventEmitter } from 'events';
import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const logger = getLogger('plugins:api:kernelServiceRegistry');

/**
 * 内核服务标识符枚举
 * 统一管理所有可注册的内核服务名称，避免魔法字符串
 */
export enum KernelServiceId {
  PLUGIN_LOADER = 'kernel.pluginLoader',
  PLUGIN_REGISTRY = 'kernel.pluginRegistry',
  LIFECYCLE_MANAGER = 'kernel.lifecycleManager',
  DEPENDENCY_MANAGER = 'kernel.dependencyManager',
  CONFIG_MANAGER = 'kernel.configManager',
  EVENT_SYSTEM = 'kernel.eventSystem',
  ERROR_SERVICE = 'kernel.errorService',
  DIContainer = 'kernel.diContainer',

  /** 会话管理服务（修复 PLUGIN_LOADER 语义错位：session API 不再复用 pluginLoader 标识） */
  SESSION_MANAGER = 'kernel.sessionManager',

  /** 插件 API 访问控制标识 */
  COMMAND_API = 'kernel.api.command',
  TOOL_API = 'kernel.api.tool',
  SETTINGS_API = 'kernel.api.settings',
  RESOURCE_API = 'kernel.api.resource',
}

/** 服务注册事件数据 */
export interface ServiceRegisteredEvent {
  serviceId: KernelServiceId;
  instance: unknown;
  timestamp: number;
}

/**
 * 服务访问权限条目
 * 定义某个插件可以访问哪些内核服务
 */
export interface ServiceAccessEntry {
  pluginId: string;
  allowedServices: KernelServiceId[];
}

/**
 * 内核服务注册表
 * 轻量级服务定位器，仅存储和返回已注册的服务实例
 */
export class KernelServiceRegistry extends EventEmitter {
  /** 服务注册事件（4.4 响应式加载订阅） */
  static readonly SERVICE_REGISTERED = 'serviceRegistered';

  private services: Map<string, any> = new Map();
  private accessControl: Map<string, Set<string>> = new Map();
  private allowAllPlugins = false;

  /**
   * 注册内核服务实例
   * @param serviceId 服务标识符
   * @param instance 服务实例
   */
  register<T>(serviceId: KernelServiceId, instance: T): void {
    const key = serviceId;

    if (this.services.has(key)) {
      logger.warning(`Kernel service already registered, overwriting: ${key}`);
    }

    this.services.set(key, instance);
    logger.info(`✅ Kernel service registered: ${key}`);

    // 4.4：发射服务注册事件，供响应式加载（pending 插件自动激活）订阅
    this.emit(KernelServiceRegistry.SERVICE_REGISTERED, {
      serviceId: key,
      instance,
      timestamp: Date.now(),
    } satisfies ServiceRegisteredEvent);
  }

  /**
   * 获取内核服务实例（带访问控制）
   * @param serviceId 服务标识符
   * @param pluginId 发起请求的插件 ID（可选，用于访问控制）
   * @returns 服务实例
   */
  resolve<T>(serviceId: KernelServiceId, pluginId?: string): T {
    const key = serviceId;

    if (pluginId && !this.allowAllPlugins) {
      const allowed = this.accessControl.get(pluginId);
      if (!allowed || !allowed.has(key)) {
        throw new AppError(
          `Plugin "${pluginId}" is not allowed to access service: ${key}`,
          ErrorCategory.PERMISSION,
          ErrorSeverity.HIGH,
          'KERNEL_SERVICE_ACCESS_DENIED'
        );
      }
    }

    const instance = this.services.get(key);

    if (!instance) {
      throw new AppError(
        `Kernel service not registered: ${key}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'KERNEL_SERVICE_NOT_FOUND'
      );
    }

    return instance as T;
  }

  /**
   * 获取内核服务实例（不检查访问控制，仅供内核模块内部使用）
   * @param serviceId 服务标识符
   * @returns 服务实例，不存在时返回 undefined
   */
  resolveInternal<T>(serviceId: KernelServiceId): T | undefined {
    return this.services.get(serviceId) as T | undefined;
  }

  /**
   * 设置插件对特定服务的访问权限
   * @param pluginId 插件 ID
   * @param allowedServices 允许访问的服务列表
   */
  grantAccess(pluginId: string, allowedServices: KernelServiceId[]): void {
    const existing = this.accessControl.get(pluginId) || new Set();

    for (const service of allowedServices) {
      existing.add(service);
    }

    this.accessControl.set(pluginId, existing);
  }

  /**
   * 撤销插件对所有服务的访问权限
   * @param pluginId 插件 ID
   */
  revokeAccess(pluginId: string): void {
    this.accessControl.delete(pluginId);
  }

  /**
   * 检查插件是否有权访问指定服务
   * @param pluginId 插件 ID
   * @param serviceId 服务标识符
   * @returns 是否有访问权限
   */
  hasAccess(pluginId: string, serviceId: KernelServiceId): boolean {
    if (this.allowAllPlugins) return true;

    const allowed = this.accessControl.get(pluginId);
    return allowed ? allowed.has(serviceId) : false;
  }

  /**
   * 获取有权限访问指定服务的所有插件列表
   * @param serviceId 服务标识符
   * @returns 有权限的插件 ID 列表
   */
  getAuthorizedPlugins(serviceId: KernelServiceId): string[] {
    const result: string[] = [];

    for (const [pluginId, allowed] of this.accessControl.entries()) {
      if (allowed.has(serviceId)) {
        result.push(pluginId);
      }
    }

    return result;
  }

  /**
   * 设置是否允许所有插件访问所有服务（用于开发/调试模式）
   * @param allow 是否允许
   */
  setAllowAllPlugins(allow: boolean): void {
    this.allowAllPlugins = allow;
  }

  /**
   * 检查服务是否已注册
   * @param serviceId 服务标识符
   * @returns 是否已注册
   */
  hasService(serviceId: KernelServiceId): boolean {
    return this.services.has(serviceId);
  }

  /**
   * 获取所有已注册服务的标识符列表
   * @returns 已注册服务列表
   */
  getRegisteredServices(): KernelServiceId[] {
    return Array.from(this.services.keys()) as KernelServiceId[];
  }

  /**
   * 获取所有已授权的访问条目
   * @returns 访问条目列表
   */
  getAccessEntries(): ServiceAccessEntry[] {
    return Array.from(this.accessControl.entries()).map(
      ([pluginId, allowedServices]) => ({
        pluginId,
        allowedServices: Array.from(allowedServices) as KernelServiceId[],
      })
    );
  }

  /**
   * 清空所有注册和访问控制
   */
  clear(): void {
    this.services.clear();
    this.accessControl.clear();
    this.allowAllPlugins = false;
    logger.info('Kernel service registry cleared');
  }
}

let registryInstance: KernelServiceRegistry | null = null;

/**
 * 获取内核服务注册表单例
 */
export function getKernelServiceRegistry(): KernelServiceRegistry {
  if (!registryInstance) {
    registryInstance = new KernelServiceRegistry();
  }
  return registryInstance;
}

/**
 * 重置内核服务注册表单例（仅用于测试）
 */
export function resetKernelServiceRegistry(): void {
  if (registryInstance) {
    registryInstance.clear();
    registryInstance = null;
  }
}
