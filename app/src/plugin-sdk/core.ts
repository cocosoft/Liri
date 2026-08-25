/**
 * plugin-sdk/core.ts - 插件 SDK 核心运行时函数
 *
 * 提供插件开发者使用的运行时工具函数。
 */

import type {
  Plugin,
  PluginContext,
  PluginManifest,
  PluginServices,
  PluginValidationResult,
  PluginValidationError,
  PluginValidationWarning,
} from './types';

/**
 * 创建插件实例的辅助函数
 * @param definition 插件定义
 * @returns 符合 SDK 标准的 Plugin 对象
 */
export function createPlugin(definition: {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags?: string[];
  category: string;
  /**
   * 声明式服务注入（必需）：声明插件依赖的内核服务名（如 "kernel.configManager"）。
   * 服务缺失时按宿主策略拒绝加载（fail-fast）或挂起等待。
   */
  inject?: string[];
  /**
   * 声明式服务注入（可选）：服务缺失时跳过注入，不阻断插件加载。
   */
  injectOptional?: string[];
  /**
   * 插件名依赖（供静态校验层使用）：inject 第三方服务时声明其提供者插件。
   */
  dependencies?: string[];
  /**
   * 可选插件名依赖：缺失不阻断。
   */
  optionalDependencies?: string[];
  initialize?: (context: PluginContext) => Promise<void> | void;
  activate?: (context: PluginContext) => Promise<void> | void;
  deactivate?: (context: PluginContext) => Promise<void> | void;
  destroy?: (context: PluginContext) => Promise<void> | void;
  /** T3.3: 热替换清理钩子（可选） */
  __hotDispose?: () => void | Promise<void>;
  skills?: Array<{
    id: string;
    name: string;
    description: string;
    parameters?: Array<{
      name: string;
      type: 'string' | 'number' | 'boolean' | 'array' | 'object';
      description: string;
      required?: boolean;
      defaultValue?: unknown;
    }>;
    execute: (
      context: import('./types').SkillContext,
      args: Record<string, unknown>
    ) => Promise<unknown>;
  }>;
}): Plugin {
  return {
    id: definition.id,
    name: definition.name,
    version: definition.version,
    description: definition.description,
    author: definition.author,
    tags: definition.tags ?? [],
    category: definition.category,
    inject: definition.inject,
    injectOptional: definition.injectOptional,
    dependencies: definition.dependencies,
    optionalDependencies: definition.optionalDependencies,
    initialize: definition.initialize,
    activate: definition.activate,
    deactivate: definition.deactivate,
    destroy: definition.destroy,
    __hotDispose: definition.__hotDispose,
    skills: definition.skills,
  };
}

/**
 * 创建注入服务容器 —— 声明式服务注入（inject）的运行时载体
 * 宿主在加载 SDK 插件时构造，将已解析的内核服务实例挂载到 context.services。
 * @param services 服务名 → 服务实例映射
 */
export function createServices(
  services: Record<string, unknown>
): PluginServices {
  const map = new Map<string, unknown>(Object.entries(services));

  return {
    get: <T>(serviceId: string): T | undefined => map.get(serviceId) as T,
    has: (serviceId: string): boolean => map.has(serviceId),
    list: (): string[] => Array.from(map.keys()),
  };
}

/**
 * 创建插件上下文（服务注入以参数形式跨过 SDK 隔离边界）
 * 宿主加载 SDK 插件时调用，SDK 侧不引用任何核心模块。
 * 未提供的可选项（log/config/events/utils）使用安全空实现，避免插件解构报错。
 * @param options 上下文基础信息与已解析的服务实例
 */
export function createPluginContext(options: {
  pluginId: string;
  pluginName: string;
  version: string;
  services?: Record<string, unknown>;
  log?: PluginContext['log'];
  config?: PluginContext['config'];
  events?: PluginContext['events'];
  utils?: PluginContext['utils'];
}): PluginContext {
  const noop = (): void => undefined;

  return {
    pluginId: options.pluginId,
    pluginName: options.pluginName,
    version: options.version,
    services: createServices(options.services ?? {}),
    log: options.log ?? {
      debug: noop,
      info: noop,
      warn: noop,
      error: noop,
    },
    config: options.config ?? {
      get: <T>(_key: string, defaultValue?: T): T => defaultValue as T,
      set: noop,
      save: async () => undefined,
    },
    events: options.events ?? {
      on: noop,
      off: noop,
      emit: noop,
    },
    utils: options.utils ?? {
      showNotification: noop,
      showProgress: noop,
    },
  };
}

/**
 * 从插件定义或清单中提取声明式服务注入声明
 * @param source 插件定义或插件清单
 * @returns 必需（inject）与可选（injectOptional）服务名列表
 */
export function getInjectedServiceIds(source: {
  inject?: string[];
  injectOptional?: string[];
}): { required: string[]; optional: string[] } {
  return {
    required: source.inject ?? [],
    optional: source.injectOptional ?? [],
  };
}

/**
 * 验证插件清单
 */
export function validatePluginManifest(
  manifest: PluginManifest
): PluginValidationResult {
  const errors: PluginValidationError[] = [];
  const warnings: PluginValidationWarning[] = [];

  if (!manifest.id) {
    errors.push({
      code: 'ERR_MISSING_ID',
      message: '插件 ID 不能为空',
      field: 'id',
    });
  } else if (!/^[a-z0-9_-]+$/.test(manifest.id)) {
    errors.push({
      code: 'ERR_INVALID_ID',
      message: '插件 ID 只能包含小写字母、数字、连字符和下划线',
      field: 'id',
    });
  }

  if (!manifest.name) {
    errors.push({
      code: 'ERR_MISSING_NAME',
      message: '插件名称不能为空',
      field: 'name',
    });
  }

  if (!manifest.version) {
    errors.push({
      code: 'ERR_MISSING_VERSION',
      message: '插件版本不能为空',
      field: 'version',
    });
  } else if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    warnings.push({
      code: 'WARN_INVALID_VERSION',
      message: '建议使用语义化版本号 (x.y.z)',
      field: 'version',
    });
  }

  if (!manifest.main) {
    errors.push({
      code: 'ERR_MISSING_MAIN',
      message: '插件入口文件不能为空',
      field: 'main',
    });
  }

  if (manifest.skills) {
    for (const [index, skill] of manifest.skills.entries()) {
      if (!skill.id) {
        errors.push({
          code: 'ERR_MISSING_SKILL_ID',
          message: `技能 #${index + 1} 缺少 ID`,
          field: `skills[${index}].id`,
        });
      }
    }
  }

  // 声明式服务注入（inject）字段校验：必须是字符串数组
  for (const field of ['inject', 'injectOptional'] as const) {
    const value = manifest[field];
    if (value !== undefined) {
      if (
        !Array.isArray(value) ||
        !value.every((item) => typeof item === 'string')
      ) {
        errors.push({
          code: 'INVALID_INJECT_FIELD',
          message: `字段 "${field}" 必须是字符串数组（服务名列表）`,
          field,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
