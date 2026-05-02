/**
 * 依赖注入容器
 * 用于管理应用中的服务依赖关系，支持单例和工厂模式
 */
export class DIContainer {
  private services = new Map<string, any>();
  private factories = new Map<string, () => any>();

  /**
   * 注册服务工厂
   * @param name 服务名称
   * @param factory 服务工厂函数
   */
  register<T>(name: string, factory: () => T): void {
    this.factories.set(name, factory);
  }

  /**
   * 注册服务实例
   * @param name 服务名称
   * @param instance 服务实例
   */
  registerInstance<T>(name: string, instance: T): void {
    this.services.set(name, instance);
  }

  /**
   * 解析服务
   * @param name 服务名称
   * @returns 服务实例
   * @throws 当服务未找到时抛出错误
   */
  resolve<T>(name: string): T {
    if (this.services.has(name)) {
      return this.services.get(name);
    }

    const factory = this.factories.get(name);
    if (factory) {
      const instance = factory();
      this.services.set(name, instance);
      return instance;
    }

    throw new Error(`Service not found: ${name}`);
  }

  /**
   * 检查服务是否存在
   * @param name 服务名称
   * @returns 是否存在
   */
  has(name: string): boolean {
    return this.services.has(name) || this.factories.has(name);
  }

  /**
   * 清除服务
   * @param name 服务名称
   */
  clear(name: string): void {
    this.services.delete(name);
    this.factories.delete(name);
  }

  /**
   * 清除所有服务
   */
  clearAll(): void {
    this.services.clear();
    this.factories.clear();
  }
}

// 全局容器实例
let container: DIContainer | null = null;

/**
 * 获取全局依赖注入容器实例
 * @returns 容器实例
 */
export function getDIContainer(): DIContainer {
  if (!container) {
    container = new DIContainer();
  }
  return container;
}

/**
 * 重置全局容器（仅用于测试）
 */
export function resetDIContainer(): void {
  container = null;
}
