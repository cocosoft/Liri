/**
 * 懒加载模块加载器
 * 支持并发安全访问、校验、重置，用于按需加载重量级模块
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * 懒加载模块加载器
 * 确保模块仅在首次访问时初始化，且并发请求只触发一次初始化
 */
export class LazyModuleLoader<T> {
  private factory: () => Promise<T> | T;
  private instance: T | null = null;
  private loading = false;
  private loadPromise: Promise<T> | null = null;
  private validator?: (instance: T) => boolean;

  /**
   * @param factory - 模块工厂函数，返回模块实例或 Promise<模块实例>
   * @param validator - 可选的校验函数，用于验证实例是否仍然有效
   */
  constructor(factory: () => Promise<T> | T, validator?: (instance: T) => boolean) {
    this.factory = factory;
    this.validator = validator;
  }

  /**
   * 获取模块实例
   * 首次调用时执行 factory 初始化，后续返回缓存实例
   * 并发调用只会触发一次初始化，其余等待同一结果
   */
  async get(): Promise<T> {
    if (this.instance !== null) {
      if (this.validator && !this.validator(this.instance)) {
        this.instance = null;
      } else {
        return this.instance;
      }
    }

    if (this.loading) {
      return this.loadPromise!;
    }

    this.loading = true;
    this.loadPromise = (async () => {
      try {
        const instance = await this.factory();
        this.instance = instance;
        return instance;
      } finally {
        this.loading = false;
        this.loadPromise = null;
      }
    })();

    return this.loadPromise;
  }

  /**
   * 同步获取已加载的实例
   * 如果模块尚未加载则抛出错误
   */
  getSync(): T {
    if (this.instance === null) {
      throw new AppError('LazyModuleLoader: 模块尚未加载，请先调用 get()', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1004');
    }
    return this.instance;
  }

  /**
   * 检查模块是否已加载
   */
  isLoaded(): boolean {
    return this.instance !== null;
  }

  /**
   * 重置加载器状态，下次 get() 时重新执行 factory
   */
  reset(): void {
    this.instance = null;
    this.loading = false;
    this.loadPromise = null;
  }
}
