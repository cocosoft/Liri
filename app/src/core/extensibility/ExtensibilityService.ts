// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * ExtensibilityService — 全局可扩展性服务
 *
 * 整合 ModuleManager、ConfigManager、EventBus，提供统一的可扩展性入口。
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { PluginType, ModuleType, ModuleState, EventType } from './types.js';
import type { Config } from './types.js';
import { ModuleManager, createModuleManager } from './ModuleManager.js';
import { ConfigManager, createConfigManager } from './ConfigManager.js';
import { EventBus, createEventBus } from './EventBus.js';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 可扩展性工具函数
 */
export const extensibilityUtils = {
  /**
   * 深度合并对象
   */
  deepMerge: (target: unknown, source: unknown): unknown => {
    if (target === null || typeof target !== 'object') {
      return source;
    }
    if (source === null || typeof source !== 'object') {
      return source;
    }
    if (Array.isArray(target) && Array.isArray(source)) {
      return [...target, ...source];
    }
    if (Array.isArray(target) || Array.isArray(source)) {
      return source;
    }

    const merged = { ...(target as Record<string, unknown>) };
    for (const key in source as Record<string, unknown>) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        merged[key] = extensibilityUtils.deepMerge(
          (target as Record<string, unknown>)[key],
          (source as Record<string, unknown>)[key]
        );
      }
    }
    return merged;
  },

  /**
   * 延迟加载模块
   */
  lazyLoad: async <T>(loader: () => Promise<T>): Promise<T> => {
    return await loader();
  },

  /**
   * 动态导入模块
   */
  dynamicImport: async <T>(path: string): Promise<T> => {
    const module = await import(path);
    return module.default || module;
  },

  /**
   * 验证插件元数据
   */
  validatePluginMetadata: (metadata: unknown): boolean => {
    return (
      typeof metadata === 'object' &&
      metadata !== null &&
      typeof (metadata as Record<string, unknown>).id === 'string' &&
      typeof (metadata as Record<string, unknown>).name === 'string' &&
      typeof (metadata as Record<string, unknown>).version === 'string' &&
      typeof (metadata as Record<string, unknown>).description === 'string' &&
      typeof (metadata as Record<string, unknown>).author === 'string' &&
      Object.values(PluginType).includes(
        (metadata as Record<string, unknown>).type as PluginType
      )
    );
  },

  /**
   * 验证模块元数据
   */
  validateModuleMetadata: (metadata: unknown): boolean => {
    return (
      typeof metadata === 'object' &&
      metadata !== null &&
      typeof (metadata as Record<string, unknown>).id === 'string' &&
      typeof (metadata as Record<string, unknown>).name === 'string' &&
      typeof (metadata as Record<string, unknown>).version === 'string' &&
      typeof (metadata as Record<string, unknown>).description === 'string' &&
      Object.values(ModuleType).includes(
        (metadata as Record<string, unknown>).type as ModuleType
      )
    );
  },
};

/**
 * 全局可扩展性服务
 */
export class ExtensibilityService {
  private moduleManager: ModuleManager;
  private configManager: ConfigManager;
  private eventBus: EventBus;

  constructor() {
    this.moduleManager = createModuleManager();
    this.configManager = createConfigManager();
    this.eventBus = createEventBus();
  }

  /**
   * 获取模块管理器
   */
  getModuleManager(): ModuleManager {
    return this.moduleManager;
  }

  /**
   * 获取配置管理器
   */
  getConfigManager(): ConfigManager {
    return this.configManager;
  }

  /**
   * 获取事件总线
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /**
   * 初始化可扩展性服务
   */
  async init(): Promise<void> {
    // 止血开关：设置 USE_LEGACY_EXTENSIBILITY=true 才启用旧 extensibility 系统
    if (process.env.USE_LEGACY_EXTENSIBILITY !== 'true') {
      logger.info(
        'ExtensibilityService 已通过 USE_LEGACY_EXTENSIBILITY 禁用，使用主系统替代'
      );
      return;
    }

    await this.configManager.loadAllConfigs();
    this.registerCoreModules();

    // 委托插件加载到 plugins/ PluginSystem，消除双轨运行
    const { pluginSystem } = await import('../../plugins/index.js');
    await pluginSystem.initialize();

    this.eventBus.emit(EventType.SYSTEM_START);
  }

  /**
   * 注册核心模块
   */
  private registerCoreModules(): void {
    // 注册配置模块
    this.moduleManager.registerLazyModule('config', async () => ({
      metadata: {
        id: 'config',
        name: 'Config Module',
        version: '1.0.0',
        description: 'Configuration management module',
        type: ModuleType.CORE,
      },
      state: ModuleState.UNLOADED,
      providers: new Map(),
      async init() {
        logger.info('Config module initialized');
      },
      async start() {
        logger.info('Config module started');
      },
      async stop() {
        logger.info('Config module stopped');
      },
      async destroy() {
        logger.info('Config module destroyed');
      },
      getProvider: <T>(name: string): T | undefined =>
        this.configManager.getConfig(name) as T,
      registerProvider: (name: string, provider: unknown): void => {
        this.configManager.registerConfig(name, provider as Config);
      },
      unregisterProvider: (name: string): void => {
        this.configManager.removeConfig(name);
      },
    }));

    // 注册插件模块
    this.moduleManager.registerLazyModule('plugin', async () => ({
      metadata: {
        id: 'plugin',
        name: 'Plugin Module',
        version: '1.0.0',
        description: 'Plugin management module',
        type: ModuleType.CORE,
      },
      state: ModuleState.UNLOADED,
      providers: new Map(),
      async init() {
        logger.info('Plugin module initialized');
      },
      async start() {
        logger.info('Plugin module started');
      },
      async stop() {
        logger.info('Plugin module stopped');
      },
      async destroy() {
        logger.info('Plugin module destroyed');
      },
      getProvider: <T>(name: string): T | undefined => undefined,
      registerProvider: (name: string, provider: unknown): void => {},
      unregisterProvider: (name: string): void => {},
    }));

    // 注册事件模块
    this.moduleManager.registerLazyModule('event', async () => ({
      metadata: {
        id: 'event',
        name: 'Event Module',
        version: '1.0.0',
        description: 'Event bus module',
        type: ModuleType.CORE,
      },
      state: ModuleState.UNLOADED,
      providers: new Map(),
      async init() {
        logger.info('Event module initialized');
      },
      async start() {
        logger.info('Event module started');
      },
      async stop() {
        logger.info('Event module stopped');
      },
      async destroy() {
        logger.info('Event module destroyed');
      },
      getProvider: <T>(name: string): T | undefined => this.eventBus as T,
      registerProvider: (name: string, provider: unknown): void => {},
      unregisterProvider: (name: string): void => {},
    }));

    // 注册技能系统模块
    this.moduleManager.registerLazyModule('skills', async () => {
      const { SkillRegistry } = await import('../../skills/SkillRegistry.js');
      const skillRegistry = new SkillRegistry();
      return {
        metadata: {
          id: 'skills',
          name: 'Skills Module',
          version: '1.0.0',
          description: 'Skills management module',
          type: ModuleType.CORE,
        },
        state: ModuleState.UNLOADED,
        providers: new Map(),
        async init() {
          logger.info('Skills module initialized');
        },
        async start() {
          logger.info('Skills module started');
        },
        async stop() {
          logger.info('Skills module stopped');
        },
        async destroy() {
          logger.info('Skills module destroyed');
        },
        getProvider: <T>(name: string): T | undefined =>
          name === 'skillRegistry' ? (skillRegistry as T) : undefined,
        registerProvider: (name: string, provider: unknown): void => {},
        unregisterProvider: (name: string): void => {},
      };
    });

    // 注册远程功能模块
    this.moduleManager.registerLazyModule('remote', async () => {
      const { RemoteSessionManager, createRemoteSessionManager } =
        await import('../../remote/RemoteSessionManager.js');
      return {
        metadata: {
          id: 'remote',
          name: 'Remote Module',
          version: '1.0.0',
          description: 'Remote connection management module',
          type: ModuleType.CORE,
        },
        state: ModuleState.UNLOADED,
        providers: new Map(),
        async init() {
          logger.info('Remote module initialized');
        },
        async start() {
          logger.info('Remote module started');
        },
        async stop() {
          logger.info('Remote module stopped');
        },
        async destroy() {
          logger.info('Remote module destroyed');
        },
        getProvider: <T>(name: string): T | undefined =>
          name === 'createRemoteSessionManager'
            ? (createRemoteSessionManager as T)
            : undefined,
        registerProvider: (name: string, provider: unknown): void => {},
        unregisterProvider: (name: string): void => {},
      };
    });

    // 注册安全性模块
    this.moduleManager.registerLazyModule('security', async () => {
      const { SandboxManager, PermissionManager, SecurityAudit } =
        await import('../../security/index.js');
      const sandboxManager = new SandboxManager();
      const permissionManager = new PermissionManager();
      const securityAudit = new SecurityAudit();
      return {
        metadata: {
          id: 'security',
          name: 'Security Module',
          version: '1.0.0',
          description: 'Security management module',
          type: ModuleType.CORE,
        },
        state: ModuleState.UNLOADED,
        providers: new Map(),
        async init() {
          logger.info('Security module initialized');
        },
        async start() {
          logger.info('Security module started');
        },
        async stop() {
          logger.info('Security module stopped');
        },
        async destroy() {
          logger.info('Security module destroyed');
        },
        getProvider: <T>(name: string): T | undefined => {
          if (name === 'sandboxManager') return sandboxManager as T;
          if (name === 'permissionManager') return permissionManager as T;
          if (name === 'securityAudit') return securityAudit as T;
          return undefined;
        },
        registerProvider: (name: string, provider: unknown): void => {},
        unregisterProvider: (name: string): void => {},
      };
    });

    // 注册性能优化模块
    this.moduleManager.registerLazyModule('performance', async () => {
      const { PerformanceOptimizer, performanceOptimizer } =
        await import('../../performance/PerformanceOptimizer.js');
      const { PerformanceProfiler, MemoryManager, MemoryCache } =
        await import('../../core/utils/Performance.js');
      const performanceProfiler = new PerformanceProfiler();
      const memoryManager = new MemoryManager();
      return {
        metadata: {
          id: 'performance',
          name: 'Performance Module',
          version: '1.0.0',
          description: 'Performance optimization module',
          type: ModuleType.CORE,
        },
        state: ModuleState.UNLOADED,
        providers: new Map(),
        async init() {
          logger.info('Performance module initialized');
        },
        async start() {
          logger.info('Performance module started');
        },
        async stop() {
          logger.info('Performance module stopped');
        },
        async destroy() {
          logger.info('Performance module destroyed');
        },
        getProvider: <T>(name: string): T | undefined => {
          if (name === 'performanceOptimizer') return performanceOptimizer as T;
          if (name === 'performanceProfiler') return performanceProfiler as T;
          if (name === 'memoryManager') return memoryManager as T;
          if (name === 'MemoryCache') return MemoryCache as T;
          return undefined;
        },
        registerProvider: (name: string, provider: unknown): void => {},
        unregisterProvider: (name: string): void => {},
      };
    });
  }

  /**
   * 启动所有模块
   */
  async startAllModules(): Promise<void> {
    for (const module of this.moduleManager.listModules()) {
      if (module.state === ModuleState.LOADED) {
        await this.moduleManager.startModule(module.metadata.id);
      }
    }
  }

  /**
   * 停止所有模块
   */
  async stopAllModules(): Promise<void> {
    for (const module of this.moduleManager.listModules()) {
      if (module.state === ModuleState.ACTIVATED) {
        await this.moduleManager.stopModule(module.metadata.id);
      }
    }
  }

  /**
   * 销毁可扩展性服务
   */
  async destroy(): Promise<void> {
    this.eventBus.emit(EventType.SYSTEM_STOP);
    await this.stopAllModules();
    await this.moduleManager.destroy();
    await this.configManager.destroy();
    this.eventBus.destroy();
  }

  /**
   * 关闭可扩展性服务
   */
  async shutdown(): Promise<void> {
    await this.destroy();
  }
}

/**
 * 全局可扩展性服务实例
 */
let globalExtensibilityService: ExtensibilityService | null = null;

/**
 * 获取全局可扩展性服务
 */
export function getExtensibilityService(): ExtensibilityService {
  if (!globalExtensibilityService) {
    globalExtensibilityService = new ExtensibilityService();
  }
  return globalExtensibilityService;
}
