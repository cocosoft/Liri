/**
 * 扩展性管理器
 * 用于管理性能优化系统的扩展点和插件机制
 */

import { logForDebugging } from '../utils/debug.js';

/**
 * 扩展点类型
 */
export enum ExtensionPoint {
  /** 启动性能分析扩展点 */
  STARTUP_PROFILING = 'startup_profiling',
  /** 慢操作检测扩展点 */
  SLOW_OPERATION_DETECTION = 'slow_operation_detection',
  /** 内存管理扩展点 */
  MEMORY_MANAGEMENT = 'memory_management',
  /** 性能分析扩展点 */
  PERFORMANCE_ANALYSIS = 'performance_analysis',
  /** 代码优化扩展点 */
  CODE_OPTIMIZATION = 'code_optimization',
  /** 缓存策略扩展点 */
  CACHE_STRATEGY = 'cache_strategy',
  /** 延迟加载扩展点 */
  LAZY_LOADING = 'lazy_loading',
  /** 性能报告扩展点 */
  PERFORMANCE_REPORTING = 'performance_reporting',
}

/**
 * 扩展接口
 */
export interface Extension {
  /** 扩展名称 */
  name: string;
  /** 扩展版本 */
  version: string;
  /** 扩展点 */
  extensionPoint: ExtensionPoint;
  /** 初始化函数 */
  initialize: () => Promise<void>;
  /** 销毁函数 */
  destroy: () => Promise<void>;
  /** 执行函数 */
  execute: (...args: any[]) => Promise<any>;
}

/**
 * 扩展性管理器
 */
export class ExtensibilityManager {
  private extensions: Map<string, Extension> = new Map();
  private extensionPoints: Map<ExtensionPoint, Set<string>> = new Map();
  private initialized: boolean = false;

  /**
   * 初始化扩展性管理器
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    logForDebugging('初始化扩展性管理器');
    
    // 初始化扩展点映射
    for (const extensionPoint of Object.values(ExtensionPoint)) {
      this.extensionPoints.set(extensionPoint, new Set());
    }

    this.initialized = true;
  }

  /**
   * 注册扩展
   */
  async registerExtension(extension: Extension): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (this.extensions.has(extension.name)) {
      logForDebugging(`扩展 ${extension.name} 已存在，将覆盖`, { level: 'warn' });
    }

    // 注册扩展
    this.extensions.set(extension.name, extension);
    
    // 将扩展添加到对应的扩展点
    const extensionPointSet = this.extensionPoints.get(extension.extensionPoint);
    if (extensionPointSet) {
      extensionPointSet.add(extension.name);
    }

    // 初始化扩展
    try {
      await extension.initialize();
      logForDebugging(`扩展 ${extension.name} 已注册并初始化`);
    } catch (error) {
      logForDebugging(`扩展 ${extension.name} 初始化失败: ${error instanceof Error ? error.message : String(error)}`, { level: 'error' });
      // 移除失败的扩展
      this.extensions.delete(extension.name);
      if (extensionPointSet) {
        extensionPointSet.delete(extension.name);
      }
    }
  }

  /**
   * 注销扩展
   */
  async unregisterExtension(name: string): Promise<void> {
    const extension = this.extensions.get(name);
    if (!extension) {
      logForDebugging(`扩展 ${name} 不存在`, { level: 'warn' });
      return;
    }

    // 销毁扩展
    try {
      await extension.destroy();
      logForDebugging(`扩展 ${name} 已销毁`);
    } catch (error) {
      logForDebugging(`扩展 ${name} 销毁失败: ${error instanceof Error ? error.message : String(error)}`, { level: 'error' });
    }

    // 从扩展点中移除
    const extensionPointSet = this.extensionPoints.get(extension.extensionPoint);
    if (extensionPointSet) {
      extensionPointSet.delete(name);
    }

    // 从扩展映射中移除
    this.extensions.delete(name);
    logForDebugging(`扩展 ${name} 已注销`);
  }

  /**
   * 获取所有扩展
   */
  getExtensions(): Extension[] {
    return Array.from(this.extensions.values());
  }

  /**
   * 获取指定扩展点的扩展
   */
  getExtensionsByPoint(extensionPoint: ExtensionPoint): Extension[] {
    const extensionPointSet = this.extensionPoints.get(extensionPoint);
    if (!extensionPointSet) {
      return [];
    }

    return Array.from(extensionPointSet).map(name => this.extensions.get(name)!).filter(Boolean);
  }

  /**
   * 执行扩展点
   */
  async executeExtensionPoint(extensionPoint: ExtensionPoint, ...args: any[]): Promise<any[]> {
    const extensions = this.getExtensionsByPoint(extensionPoint);
    const results: any[] = [];

    for (const extension of extensions) {
      try {
        const result = await extension.execute(...args);
        results.push(result);
      } catch (error) {
        logForDebugging(`扩展 ${extension.name} 执行失败: ${error instanceof Error ? error.message : String(error)}`, { level: 'error' });
      }
    }

    return results;
  }

  /**
   * 销毁扩展性管理器
   */
  async destroy(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    // 销毁所有扩展
    const extensions = this.getExtensions();
    for (const extension of extensions) {
      try {
        await extension.destroy();
      } catch (error) {
        logForDebugging(`扩展 ${extension.name} 销毁失败: ${error instanceof Error ? error.message : String(error)}`, { level: 'error' });
      }
    }

    // 清空扩展和扩展点
    this.extensions.clear();
    this.extensionPoints.clear();
    this.initialized = false;

    logForDebugging('扩展性管理器已销毁');
  }
}

/**
 * 全局扩展性管理器实例
 */
export const extensibilityManager = new ExtensibilityManager();

/**
 * 注册扩展
 */
export async function registerExtension(extension: Extension): Promise<void> {
  await extensibilityManager.registerExtension(extension);
}

/**
 * 注销扩展
 */
export async function unregisterExtension(name: string): Promise<void> {
  await extensibilityManager.unregisterExtension(name);
}

/**
 * 执行扩展点
 */
export async function executeExtensionPoint(extensionPoint: ExtensionPoint, ...args: any[]): Promise<any[]> {
  return extensibilityManager.executeExtensionPoint(extensionPoint, ...args);
}

/**
 * 获取所有扩展
 */
export function getExtensions(): Extension[] {
  return extensibilityManager.getExtensions();
}

/**
 * 获取指定扩展点的扩展
 */
export function getExtensionsByPoint(extensionPoint: ExtensionPoint): Extension[] {
  return extensibilityManager.getExtensionsByPoint(extensionPoint);
}
