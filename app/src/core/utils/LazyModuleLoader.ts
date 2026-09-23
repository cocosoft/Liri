/**
 * 懒加载模块加载器
 * 支持并发安全访问、校验、重置，用于按需加载重量级模块
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('core:utils:LazyModuleLoader');

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
  constructor(
    factory: () => Promise<T> | T,
    validator?: (instance: T) => boolean
  ) {
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
      throw new AppError(
        'LazyModuleLoader: 模块尚未加载，请先调用 get()',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1004'
      );
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
   * R6（2026-09-22）：**同步**获取实例（未加载时同步执行 factory）。
   *
   * 用于**同步调用链**需要真实实例的场景（如 HTTP 控制面 `getAgentTool()`、
   * CLI 命令层按具体类型消费工具）—— 原先它们只能拿 `getSync()`（未加载即抛错）
   * 或拿到懒加载包装器（`instanceof` 恒 false）。
   *
   * 约束：
   *  - factory 必须是**同步**的；返回 Promise 时抛错（调用方应改用 `get()`）——
   *    这样"工具 creator 同步可调"这一前提被显式校验，而不是静默返回半成品；
   *  - 若异步 `get()` 正在加载中 ⇒ 抛错，**不并发执行 factory**：
   *    工具工厂（如 `ToolFactory.createAgentTool()`）多为"每次返回新实例"，
   *    并发会造出两个实例、后续 `get()`/`getSync()` 结果分叉。
   */
  loadSync(): T {
    if (this.instance !== null) return this.instance;
    if (this.loading) {
      throw new AppError(
        'LazyModuleLoader: 异步加载进行中，无法同步加载',
        ErrorCategory.EXECUTION,
        ErrorSeverity.MEDIUM,
        '1004'
      );
    }
    const produced = this.factory();
    if (produced instanceof Promise) {
      throw new AppError(
        'LazyModuleLoader: factory 为异步，无法同步加载（请改用 get()）',
        ErrorCategory.EXECUTION,
        ErrorSeverity.MEDIUM,
        '1004'
      );
    }
    this.instance = produced;
    return produced;
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
