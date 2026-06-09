/**
 * RegistrationStub — 插件注册存根（§5 向后兼容性保障 — 措施4）
 *
 * 未插件化的旧模块通过 RegistrationStub 自动注册到 PluginRegistry，
 * 使所有模块对上层呈现一致的访问接口。
 *
 * 使用场景：
 * - 迁移过渡期，旧模块尚未完成插件化包装
 * - 轻量模块不需要完整插件生命周期
 * - 第三方未插件化的模块需要统一发现
 */

import type { PluginRegistry } from '../core/PluginRegistry';
import type { LoadedPlugin } from '../../types/plugin';
import { PluginState } from '../types/PluginTypes.js';
import type { PluginRegistration } from '../types/PluginTypes.js';

/**
 * 存根注册选项
 */
export interface StubOptions {
  version?: string;
  description?: string;
  enabled?: boolean;
  source?: string;
  repository?: string;
  /** 旧模块的导出引用，供向后兼容访问 */
  moduleExports?: Record<string, unknown>;
}

/**
 * 插件注册存根
 * 为未插件化的模块提供 LoadedPlugin 兼容包装，自动注册到 PluginRegistry
 */
export class RegistrationStub {
  /**
   * 将旧模块包装为 LoadedPlugin 并注册到 PluginRegistry
   *
   * @param registry PluginRegistry 实例
   * @param name 模块/插件名称
   * @param options 注册选项
   * @returns 注册的 LoadedPlugin 对象（含 moduleExports 引用）
   */
  static register(
    registry: PluginRegistry,
    name: string,
    options: StubOptions = {}
  ): LoadedPlugin {
    const plugin: LoadedPlugin = {
      id: name,
      name,
      version: options.version || '1.0.0',
      state: PluginState.ACTIVATED,
      manifest: {
        name,
        version: options.version || '1.0.0',
        description: options.description || '',
      },
      path: '',
      source: options.source || 'bundled',
      repository: options.repository || '',
      enabled: options.enabled !== false,
      isBuiltin: options.source === 'bundled',
    };

    if (options.moduleExports) {
      (plugin as any).moduleExports = options.moduleExports;
    }

    const registration: PluginRegistration = {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      path: plugin.path,
      state: plugin.state,
      registeredAt: new Date(),
      enabled: plugin.enabled,
      dependencies: [],
      dependents: [],
    };
    registry.registerPlugin(registration);

    return plugin;
  }

  /**
   * 批量注册多个旧模块
   *
   * @param registry PluginRegistry 实例
   * @param modules 模块列表，每项包含 name 和可选的 StubOptions
   * @returns 注册的 LoadedPlugin 数组
   */
  static registerBatch(
    registry: PluginRegistry,
    modules: Array<{ name: string } & StubOptions>
  ): LoadedPlugin[] {
    return modules.map((mod) => {
      const { name, ...opts } = mod;
      return RegistrationStub.register(registry, name, opts);
    });
  }

  /**
   * 创建 BundledPluginManager 兼容的回退加载器
   * 当 PluginRegistry.get() 找不到插件时，自动从内置列表创建存根
   *
   * @param bundled 内置插件元数据列表
   * @returns 回退加载函数，可直接传给 PluginRegistry.setFallback()
   */
  static createBundledFallback(
    bundled: Array<{
      name: string;
      version: string;
      description: string;
      enabled: boolean;
    }>
  ): (pluginName: string) => LoadedPlugin | undefined {
    return (pluginName: string): LoadedPlugin | undefined => {
      const match = bundled.find((p) => p.name === pluginName);
      if (!match) return undefined;

      return {
        id: match.name,
        name: match.name,
        version: match.version,
        state: PluginState.ACTIVATED,
        manifest: {
          name: match.name,
          version: match.version,
          description: match.description,
        },
        path: '',
        source: 'bundled',
        repository: '',
        enabled: match.enabled,
        isBuiltin: true,
      };
    };
  }

  /**
   * 检查 LoadedPlugin 是否为由 RegistrationStub 创建的存根
   *
   * @param plugin 插件对象
   * @returns 是否为存根
   */
  static isStub(plugin: LoadedPlugin): boolean {
    return !!(plugin as any).moduleExports;
  }

  /**
   * 从存根中获取原始模块导出
   *
   * @param plugin 存根插件对象
   * @returns 模块导出引用，或 undefined（如果不是存根）
   */
  static getModuleExports<T = Record<string, unknown>>(
    plugin: LoadedPlugin
  ): T | undefined {
    return (plugin as any).moduleExports as T | undefined;
  }
}
