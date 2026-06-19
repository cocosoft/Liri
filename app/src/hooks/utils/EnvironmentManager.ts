/**
 * 环境变量管理工具
 * 提供环境变量的处理和管理功能
 * 参考CC源码: cc_code/backend/utils/subprocessEnv.ts
 */

import { platform } from 'os';
import { resolveProjectRoot } from '@modules/core';

/**
 * 环境变量选项
 */
export interface EnvOptions {
  pluginOptions?: Record<string, string>;
  skillRoot?: string;
  sessionId?: string;
  [key: string]: any;
}

/**
 * 环境变量管理类
 */
export class EnvironmentManager {
  private static instance: EnvironmentManager;
  private envCache: Map<string, Record<string, string>> = new Map();

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): EnvironmentManager {
    if (!EnvironmentManager.instance) {
      EnvironmentManager.instance = new EnvironmentManager();
    }
    return EnvironmentManager.instance;
  }

  /**
   * 构建环境变量
   */
  buildEnvironment(options: EnvOptions = {}): Record<string, string> {
    const cacheKey = this.generateCacheKey(options);

    // 检查缓存
    if (this.envCache.has(cacheKey)) {
      return { ...this.envCache.get(cacheKey)! };
    }

    // 基础环境变量
    const env: Record<string, string> = {
      ...process.env,
      Liri_HOME: this.getPyAppHome(),
      Liri_SESSION_ID: options.sessionId || '',
      Liri_PLATFORM: platform(),
      Liri_SKILL_ROOT: options.skillRoot || '',
    };

    // 添加插件选项
    if (options.pluginOptions) {
      for (const [key, value] of Object.entries(options.pluginOptions)) {
        env[`Liri_PLUGIN_${key.toUpperCase().replace(/[^a-zA-Z0-9_]/g, '_')}`] =
          value;
      }
    }

    // 跨平台路径转换
    this.normalizePaths(env);

    // 安全处理
    this.sanitizeEnvironment(env);

    // 缓存结果
    this.envCache.set(cacheKey, { ...env });

    return env;
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(options: EnvOptions): string {
    const parts = [
      options.sessionId || '',
      options.skillRoot || '',
      JSON.stringify(options.pluginOptions || {}),
    ];
    return parts.join('|');
  }

  /**
   * 获取Liri_HOME路径
   */
  private getPyAppHome(): string {
    return resolveProjectRoot();
  }

  /**
   * 跨平台路径转换
   */
  private normalizePaths(env: Record<string, string>): void {
    for (const [key, value] of Object.entries(env)) {
      if (key.toLowerCase().includes('path') && value) {
        if (platform() === 'win32') {
          // Windows路径处理
          env[key] = value.replace(/\//g, '\\');
        } else {
          // Unix路径处理
          env[key] = value.replace(/\\/g, '/');
        }
      }
    }
  }

  /**
   * 安全处理环境变量
   */
  private sanitizeEnvironment(env: Record<string, string>): void {
    // 移除敏感信息
    const sensitiveKeys = ['PASSWORD', 'TOKEN', 'SECRET', 'KEY', 'AUTH'];

    for (const key of Object.keys(env)) {
      const upperKey = key.toUpperCase();
      for (const sensitive of sensitiveKeys) {
        if (upperKey.includes(sensitive)) {
          env[key] = '***REDACTED***';
          break;
        }
      }
    }
  }

  /**
   * 无效化环境缓存
   */
  invalidateCache(): void {
    this.envCache.clear();
  }

  /**
   * 为特定会话无效化缓存
   */
  invalidateSessionCache(sessionId: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.envCache.keys()) {
      if (key.includes(sessionId)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.envCache.delete(key);
    }
  }

  /**
   * 获取环境变量统计
   */
  getStats(): {
    cacheSize: number;
    platform: string;
    home: string;
  } {
    return {
      cacheSize: this.envCache.size,
      platform: platform(),
      home: this.getPyAppHome(),
    };
  }

  /**
   * 重置管理器
   */
  reset(): void {
    this.envCache.clear();
  }
}

/**
 * 导出单例
 */
export const environmentManager = EnvironmentManager.getInstance();

// 辅助函数
function dirname(path: string): string {
  return path.substring(0, path.lastIndexOf('/'));
}
