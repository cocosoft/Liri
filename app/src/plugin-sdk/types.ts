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
 * plugin-sdk/types.ts - 插件 SDK 公开类型定义
 *
 * 为第三方插件开发者提供的所有公开类型。
 * 此目录不引用任何核心模块，保持独立纯净。
 */

/** 插件上下文 — 运行时注入给插件的 API 接口 */
export interface PluginContext {
  pluginId: string;
  pluginName: string;
  version: string;

  log: {
    debug: (message: string, ...args: unknown[]) => void;
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };

  config: {
    get: <T>(key: string, defaultValue?: T) => T;
    set: <T>(key: string, value: T) => void;
    save: () => Promise<void>;
  };

  events: {
    on: (event: string, callback: (...args: unknown[]) => void) => void;
    off: (event: string, callback: (...args: unknown[]) => void) => void;
    emit: (event: string, ...args: unknown[]) => void;
  };

  utils: {
    showNotification: (
      message: string,
      type?: 'info' | 'success' | 'warning' | 'error'
    ) => void;
    showProgress: (label: string, current: number, total: number) => void;
  };

  /**
   * 声明式注入的内核服务（与 manifest `inject` / `injectOptional` 声明对应）。
   * 服务实例以参数形式跨过 SDK 隔离边界注入，SDK 侧不引用任何核心模块。
   */
  services?: PluginServices;

  /**
   * 可逆副作用（4.3）：注册逆操作，插件卸载/注销时按 LIFO 自动执行。
   * 对齐 Cordis ctx.effect 语义——插件作者无需手写清理逻辑。
   * 需在插件激活后调用（宿主实现会校验 use-before-activate）。
   */
  onDispose?: (disposer: () => void | Promise<void>) => void;
}

/**
 * 注入服务容器 —— 声明式服务注入（inject）的运行时载体
 * 由宿主（PluginSystem）构造，将已解析的内核服务实例挂载到 context。
 */
export interface PluginServices {
  /** 按服务名取服务实例（如 "kernel.configManager"），未注入返回 undefined */
  get: <T>(serviceId: string) => T | undefined;
  /** 检查指定服务是否已注入 */
  has: (serviceId: string) => boolean;
  /** 已注入的服务名列表 */
  list: () => string[];
}

/**
 * 内核服务标识符字面量（与 plugins 侧 KernelServiceId 枚举值对齐）
 * 采用字面量联合而非 import 核心枚举，以保持 SDK 隔离边界（plugin-sdk/AGENTS.md 零反向引用）。
 */
export type KernelServiceIdName =
  | 'kernel.pluginLoader'
  | 'kernel.pluginRegistry'
  | 'kernel.lifecycleManager'
  | 'kernel.dependencyManager'
  | 'kernel.configManager'
  | 'kernel.eventSystem'
  | 'kernel.errorService'
  | 'kernel.diContainer'
  | 'kernel.sessionManager'
  | 'kernel.api.command'
  | 'kernel.api.tool'
  | 'kernel.api.settings'
  | 'kernel.api.resource';

/**
 * 声明式服务注入的类型化映射（4.2）：服务名 → 服务实例
 * 第三方插件可通过 `services.get<具体接口>('kernel.configManager')` 获得类型提示；
 * 具体服务接口由宿主实现方在 SDK 类型层面声明（可在此扩展映射，保持 SDK 零运行时依赖）。
 */
export type ServicesMap = Partial<Record<KernelServiceIdName, unknown>>;

/** 技能上下文 */
export interface SkillContext {
  pluginId: string;
  skillId: string;
  log: {
    debug: (message: string, ...args: unknown[]) => void;
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };
}

/** 技能参数定义 */
export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  defaultValue?: unknown;
}

/** 技能定义 */
export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  parameters?: SkillParameter[];
  execute: (
    context: SkillContext,
    args: Record<string, unknown>
  ) => Promise<unknown>;
}

/** 插件定义 */
export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  category: string;

  /**
   * 声明式服务注入（必需）：声明插件依赖的内核服务，如 "kernel.configManager"。
   * 服务缺失时按宿主策略拒绝加载（fail-fast）或挂起等待。
   */
  inject?: string[];

  /**
   * 声明式服务注入（可选）：服务缺失时跳过注入，不阻断插件加载。
   */
  injectOptional?: string[];

  /**
   * 插件名依赖（供静态校验层使用）：当 inject 声明第三方服务时，
   * 服务提供者插件需在此声明（对齐 PluginManifest.dependencies 语义）。
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

  /**
   * T3.3: 热替换清理钩子（可选）。
   * destroy 无法回收模块级全局状态（require.cache、全局监听器、setInterval），
   * 插件声明 __hotDispose() 显式清理。未声明者默认保守拒绝热替换（保留旧版本）。
   */
  __hotDispose?: () => void | Promise<void>;

  skills?: SkillDefinition[];
}

/** 插件配置 */
export interface PluginConfig {
  [key: string]: unknown;
}

/** 插件运行时 — 插件实例的运行时封装 */
export interface PluginRuntime {
  plugin: Plugin;
  context: PluginContext;
  status: PluginRuntimeStatus;
  startedAt?: number;
}

/** 插件运行时状态 */
export enum PluginRuntimeStatus {
  CREATED = 'created',
  INITIALIZING = 'initializing',
  ACTIVE = 'active',
  DEACTIVATING = 'deactivating',
  INACTIVE = 'inactive',
  ERROR = 'error',
}

/** 工具注册信息 */
export interface ToolRegistration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
  pluginId?: string;
}

/** 插件清单（位于 package.json 的 "pyapp" 字段） */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  type: string;
  main: string;
  engine?: string;
  dependencies?: string[];
  optionalDependencies?: string[];
  /**
   * 声明式服务注入（必需）：声明插件依赖的内核服务名（如 "kernel.configManager"）。
   * 与 dependencies（插件名依赖）分离，对齐 Cordis 的 inject 语义。
   */
  inject?: string[];
  /**
   * 声明式服务注入（可选）：服务缺失时跳过注入，不阻断插件加载。
   */
  injectOptional?: string[];
  keywords?: string[];
  homepage?: string;
  license?: string;
  icon?: string;
  skills?: PluginSkillManifest[];
  hooks?: PluginHookManifest[];
  configSchema?: Record<string, unknown>;
}

/** 技能清单 */
export interface PluginSkillManifest {
  id: string;
  name: string;
  description: string;
  parameters?: PluginSkillParameter[];
  entryFunction?: string;
}

/** 技能参数清单 */
export interface PluginSkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  defaultValue?: unknown;
  enum?: string[];
}

/** Hook 清单 */
export interface PluginHookManifest {
  name: string;
  phase: 'before' | 'after' | 'onError';
  entryFunction: string;
  priority?: number;
}

/** 验证结果 */
export interface PluginValidationResult {
  valid: boolean;
  errors: PluginValidationError[];
  warnings: PluginValidationWarning[];
}

/** 验证错误 */
export interface PluginValidationError {
  code: string;
  message: string;
  field?: string;
}

/** 验证警告 */
export interface PluginValidationWarning {
  code: string;
  message: string;
  field?: string;
}
