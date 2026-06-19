/**
 * 定义插件元数据、生命周期、依赖关系、事件等核心类型
 */

import type { PluginManifest } from '@modules/types/plugin.js';

/**
 * 插件生命周期状态
 */
export enum PluginState {
  /** 未加载 */
  UNLOADED = 'unloaded',

  /** 加载中 */
  LOADING = 'loading',

  /** 已加载 */
  LOADED = 'loaded',

  /** 已激活 */
  ACTIVATED = 'activated',

  /** 已停用 */
  DEACTIVATED = 'deactivated',

  /** 失败 */
  FAILED = 'failed',

  /** 已禁用 */
  DISABLED = 'disabled',

  /** 已启用 */
  ENABLED = 'enabled',
}

/**
 * 插件类型
 */
export enum PluginType {
  /** 工具插件 */
  TOOL = 'tool',

  /** 主题插件 */
  THEME = 'theme',

  /** 语言插件 */
  LANGUAGE = 'language',

  /** 集成插件 */
  INTEGRATION = 'integration',

  /** 工具插件 */
  UTILITY = 'utility',

  /** 自定义插件 */
  CUSTOM = 'custom',
}

/**
 * 插件依赖
 */
export interface PluginDependency {
  /** 依赖插件名称 */
  name: string;

  /** 依赖版本范围 */
  version?: string;

  /** 是否必需 */
  required?: boolean;

  /** 依赖类型 */
  type?: 'runtime' | 'development' | 'peer';
}

/**
 * 插件元数据
 */
export interface PluginMetadata {
  /** 插件ID */
  id: string;

  /** 插件名称 */
  name: string;

  /** 插件版本 */
  version: string;

  /** 插件描述 */
  description: string;

  /** 插件作者 */
  author: string;

  /** 插件类型 */
  type: PluginType;

  /** 插件依赖 */
  dependencies?: PluginDependency[];

  /** 主入口文件 */
  main?: string;

  /** 入口点 */
  entryPoint?: string;

  /** 插件图标 */
  icon?: string;

  /** 插件主页 */
  homepage?: string;

  /** 许可证 */
  license?: string;

  /** 关键字 */
  keywords?: string[];

  /** 扩展字段 */
  [key: string]: unknown;
}

/**
 * 插件配置
 */
export interface PluginConfig {
  /** 插件仓库配置 */
  repositories?: Record<
    string,
    {
      name: string;
      url: string;
      type: 'git' | 'npm' | 'local';
    }
  >;

  /** 启用的插件列表 */
  enabled?: string[];

  /** 禁用的插件列表 */
  disabled?: string[];

  /** 配置项 */
  [key: string]: unknown;
}

/**
 * 插件上下文
 */
export interface PluginContext {
  /** 插件ID */
  pluginId: string;

  /** 插件目录 */
  pluginDir: string;

  /** 应用根目录 */
  appRoot: string;

  /** 配置获取方法 */
  getConfig: <T>(key: string, defaultValue?: T) => T;

  /** 配置设置方法 */
  setConfig: (key: string, value: unknown) => Promise<void>;

  /** 日志方法 */
  log: (
    level: 'info' | 'warn' | 'error',
    message: string,
    data?: unknown
  ) => void;

  /** 事件发射方法 */
  emit: (event: string, data?: unknown) => void;

  /** 工具注册方法 */
  registerTool: (tool: PluginTool) => void;

  /** 命令注册方法 */
  registerCommand: (command: PluginCommand) => void;

  /** 钩子注册方法 */
  registerHook: (hook: PluginHook) => void;
}

/**
 * 插件工具定义
 */
export interface PluginTool {
  /** 工具名称 */
  name: string;

  /** 工具描述 */
  description: string;

  /** 工具参数 */
  parameters?: Record<string, unknown>;

  /** 工具执行方法 */
  execute: (context: PluginContext, args?: unknown) => Promise<unknown>;
}

/**
 * 插件命令定义
 */
export interface PluginCommand {
  /** 命令名称 */
  name: string;

  /** 命令描述 */
  description: string;

  /** 命令参数 */
  arguments?: Record<string, unknown>;

  /** 命令执行方法 */
  execute: (context: PluginContext, args?: unknown) => Promise<unknown>;
}

/**
 * 插件钩子定义
 */
export interface PluginHook {
  /** 钩子名称 */
  name: string;

  /** 钩子事件 */
  event: string;

  /** 钩子优先级 */
  priority?: number;

  /** 钩子执行方法 */
  handler: (context: PluginContext, data?: unknown) => Promise<unknown>;
}

/**
 * 插件接口
 */
export interface Plugin {
  /** 插件元数据 */
  metadata: PluginMetadata;

  /** 插件状态 */
  state: PluginState;

  /** 插件实例 */
  instance?: unknown;

  /** 错误信息 */
  error?: string;

  /** 加载插件 */
  load(): Promise<void>;

  /** 卸载插件 */
  unload(): Promise<void>;

  /** 激活插件 */
  activate(): Promise<void>;

  /** 停用插件 */
  deactivate(): Promise<void>;
}

/**
 * 已加载插件（融合版 — 兼容 PluginTypes / types/plugin / plugins/types/index 三套消费者）
 * 新增字段均为可选，通过 Partial<> 策略覆盖所有使用方需求
 */
export interface LoadedPlugin {
  /** 插件ID */
  id: string;

  /** 插件名称 */
  name: string;

  /** 插件版本 */
  version: string;

  /** 插件状态 */
  state: PluginState;

  /** 插件路径 */
  path: string;

  /** 插件配置 */
  config?: PluginConfig;

  /** 插件清单（来自 types/plugin.ts 消费方） */
  manifest?: PluginManifest;

  /** 是否启用 */
  enabled: boolean;

  /** 插件来源 */
  source: string;

  /** 插件仓库 */
  repository?: string;

  /** 是否为内置插件 */
  isBuiltin?: boolean;

  /** 插件实例 */
  instance?: unknown;

  /** 错误信息 */
  error?: string;

  /** Git 提交 SHA */
  sha?: string;

  /** 命令路径列表 */
  commandsPaths?: string[];

  /** 代理路径列表 */
  agentsPaths?: string[];

  /** 技能路径列表 */
  skillsPaths?: string[];

  /** 钩子配置 */
  hooksConfig?: Record<string, unknown>;

  /** MCP 服务器配置 */
  mcpServers?: Array<Record<string, unknown>>;

  /** 设置 */
  settings?: Record<string, unknown>;

  /** 依赖列表 */
  dependencies?: string[];

  /** 被依赖列表 */
  dependents?: string[];

  /** 加载时间 */
  loadedAt?: Date;

  /** 激活时间 */
  activatedAt?: Date;

  /** 停用时间 */
  deactivatedAt?: Date;

  /** 统计信息 */
  stats?: {
    /** 加载次数 */
    loadCount: number;
    /** 激活次数 */
    activateCount: number;
    /** 错误次数 */
    errorCount: number;
    /** 最后使用时间 */
    lastUsedAt?: Date;
  };
}

/**
 * 插件加载选项
 */
export interface PluginLoaderOptions {
  /** 插件目录 */
  pluginDirectories?: string[];

  /** 是否自动加载 */
  autoLoad?: boolean;

  /** 是否自动激活 */
  autoActivate?: boolean;

  /** 是否启用验证 */
  validationEnabled?: boolean;

  /** 是否启用缓存 */
  cacheEnabled?: boolean;

  /** 最大并发加载数 */
  maxConcurrentLoads?: number;

  /** 加载超时时间 */
  loadTimeout?: number;
}

/**
 * 插件注册信息
 */
export interface PluginRegistration {
  /** 插件ID */
  id: string;

  /** 插件名称 */
  name: string;

  /** 插件版本 */
  version: string;

  /** 插件路径 */
  path: string;

  /** 插件状态 */
  state: PluginState;

  /** 注册时间 */
  registeredAt: Date;

  /** 最后加载时间 */
  lastLoadedAt?: Date;

  /** 是否启用 */
  enabled: boolean;

  /** 依赖关系 */
  dependencies: string[];

  /** 被依赖关系 */
  dependents: string[];

  /** 插件清单（可选，用于兼容旧版 LoadedPlugin 的 manifest 访问） */
  manifest?: Record<string, unknown>;
}

/**
 * 插件事件类型
 */
export enum PluginEventType {
  /** 插件加载前 */
  BEFORE_LOAD = 'beforeLoad',

  /** 插件加载后 */
  AFTER_LOAD = 'afterLoad',

  /** 插件激活前 */
  BEFORE_ACTIVATE = 'beforeActivate',

  /** 插件激活后 */
  AFTER_ACTIVATE = 'afterActivate',

  /** 插件停用前 */
  BEFORE_DEACTIVATE = 'beforeDeactivate',

  /** 插件停用后 */
  AFTER_DEACTIVATE = 'afterDeactivate',

  /** 插件卸载前 */
  BEFORE_UNLOAD = 'beforeUnload',

  /** 插件卸载后 */
  AFTER_UNLOAD = 'afterUnload',

  /** 插件错误 */
  ERROR = 'error',

  /** 状态变化 */
  STATE_CHANGED = 'stateChanged',

  /** 插件已加载 */
  PLUGIN_LOADED = 'pluginLoaded',

  /** 插件已激活 */
  PLUGIN_ACTIVATED = 'pluginActivated',

  /** 插件已停用 */
  PLUGIN_DEACTIVATED = 'pluginDeactivated',

  /** 插件错误 */
  PLUGIN_ERROR = 'pluginError',

  /** 配置更新 */
  CONFIG_UPDATED = 'configUpdated',
}

/**
 * 插件事件
 */
export interface PluginEvent {
  /** 事件类型 */
  type: PluginEventType;

  /** 插件ID */
  pluginId: string;

  /** 事件数据 */
  data?: unknown;

  /** 事件时间戳 */
  timestamp: Date;
}

/**
 * 插件加载结果
 */
export interface PluginLoadResult {
  /** 是否成功 */
  success: boolean;

  /** 加载的插件 */
  plugin?: LoadedPlugin;

  /** 错误信息 */
  error?: string;

  /** 警告信息 */
  warnings?: string[];
}

/**
 * 插件验证结果
 */
export interface PluginValidationResult {
  /** 是否有效 */
  valid: boolean;

  /** 错误信息 */
  errors: string[];

  /** 警告信息 */
  warnings: string[];
}

/**
 * 插件依赖解析结果
 */
export interface PluginDependencyResolution {
  /** 是否成功 */
  success: boolean;

  /** 解析的依赖链 */
  dependencyChain: string[];

  /** 缺失的依赖 */
  missingDependencies: string[];

  /** 循环依赖 */
  circularDependencies: string[][];

  /** 错误信息 */
  error?: string;
}

// 导出所有类型
// 注意：这些类型已经在顶部使用export声明，不需要再次导出
