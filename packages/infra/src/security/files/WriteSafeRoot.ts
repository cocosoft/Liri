/**
 * 安全写入根管理
 * 对标 Hermes HERMES_WRITE_SAFE_ROOT 环境变量
 * 限制 Agent 写入路径在指定安全根目录下
 */
import path from 'path';

/**
 * 环境变量名：安全写入根目录
 */
export const WRITE_SAFE_ROOT_ENV = 'Liri_WRITE_SAFE_ROOT';

/**
 * 安全写入根管理器
 */
export class WriteSafeRoot {
  private safeRoot: string | null = null;

  /**
   * 构造函数
   * 从环境变量 Liri_WRITE_SAFE_ROOT 读取安全根目录
   */
  constructor() {
    this.loadFromEnv();
  }

  /**
   * 从环境变量加载安全根目录
   */
  loadFromEnv(): void {
    const envRoot = process.env[WRITE_SAFE_ROOT_ENV];

    if (envRoot && envRoot.trim().length > 0) {
      this.safeRoot = path.resolve(envRoot.trim());
    }
  }

  /**
   * 设置安全根目录
   * @param rootPath 根目录路径，传 null 表示清除
   */
  setSafeRoot(rootPath: string | null): void {
    if (rootPath === null) {
      this.safeRoot = null;
    } else {
      this.safeRoot = path.resolve(rootPath);
    }
  }

  /**
   * 获取当前安全根目录
   * @returns 安全根目录路径，若未设置返回 null
   */
  getSafeRoot(): string | null {
    return this.safeRoot;
  }

  /**
   * 检查安全根目录是否已设置
   * @returns 是否已设置
   */
  isEnabled(): boolean {
    return this.safeRoot !== null;
  }

  /**
   * 规范化路径
   * @param p 输入路径
   * @returns 规范化后的绝对路径
   */
  private normalizePath(p: string): string {
    return path.resolve(p).replace(/\\/g, '/');
  }

  /**
   * 检查给定路径是否在安全根目录内
   * @param targetPath 待检查的路径
   * @returns 是否允许写入
   */
  isWithinSafeRoot(targetPath: string): boolean {
    if (!this.safeRoot) {
      return true;
    }

    const normalizedTarget = this.normalizePath(targetPath);
    const normalizedRoot = this.normalizePath(this.safeRoot);

    return (
      normalizedTarget === normalizedRoot ||
      normalizedTarget.startsWith(normalizedRoot + '/')
    );
  }

  /**
   * 获取安全根目录范围描述
   * @returns 描述信息
   */
  getRestrictionDescription(): string {
    if (!this.safeRoot) {
      return '无写入根限制';
    }

    return `写入操作仅限目录: ${this.safeRoot}`;
  }
}

/**
 * 全局安全写入根实例
 */
let globalWriteSafeRoot: WriteSafeRoot | null = null;

/**
 * 获取全局安全写入根实例
 * @returns WriteSafeRoot 实例
 */
export function getWriteSafeRoot(): WriteSafeRoot {
  if (!globalWriteSafeRoot) {
    globalWriteSafeRoot = new WriteSafeRoot();
  }

  return globalWriteSafeRoot;
}

/**
 * 重置全局安全写入根实例
 */
export function resetWriteSafeRoot(): void {
  globalWriteSafeRoot = null;
}
