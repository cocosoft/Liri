/**
 * 插件类型定义 — 插件开发者 API 层
 *
 * 本文件作为插件开发者 API 类型定义，与 PluginTypes.ts（插件管理基础设施类型）分工不同。
 * 为便于消费者迁移，重导出 PluginTypes.ts 的非冲突类型。
 */

// === 重导出 PluginTypes.ts 的非冲突类型（P0 类型统一） ===
// PluginState/PluginType/PluginEventType 是 enum（运行时值），统一用 value re-export
export type {
  PluginEvent,
  PluginDependencyResolution,
  PluginConfig,
  PluginRegistration,
  LoadedPlugin,
  PluginLoadResult,
} from './PluginTypes.js';
export { PluginState, PluginType, PluginEventType } from './PluginTypes.js';

// ====================================================

/**
 * 插件生命周期状态（5态 — 插件开发者视角）
 * 注意：区别于 PluginState（8态 — 管理基础设施视角）
 */
export enum PluginStatus {
  /**
   * 已注册
   */
  REGISTERED = 'registered',
  /**
   * 已加载
   */
  LOADED = 'loaded',
  /**
   * 已启用
   */
  ENABLED = 'enabled',
  /**
   * 已禁用
   */
  DISABLED = 'disabled',
  /**
   * 出错
   */
  ERROR = 'error',
}

/**
 * 插件依赖
 */
export interface PluginDependency {
  /**
   * 依赖插件名称
   */
  name: string;
  /**
   * 依赖版本范围
   */
  version?: string;
}

/**
 * 插件元数据
 */
export interface PluginMetadata {
  /**
   * 插件ID
   */
  id?: string;
  /**
   * 插件名称
   */
  name: string;
  /**
   * 插件版本
   */
  version: string;
  /**
   * 插件描述
   */
  description?: string;
  /**
   * 插件作者
   */
  author?: string;
  /**
   * 插件主页
   */
  homepage?: string;
  /**
   * 插件许可证
   */
  license?: string;
  /**
   * 插件依赖
   */
  dependencies?: PluginDependency[];
  /**
   * 插件类型
   */
  type?: 'tool' | 'command' | 'service' | 'ui' | 'other';
  /**
   * 插件主入口
   */
  main?: string;
  /**
   * 插件图标
   */
  icon?: string;
  /**
   * 插件标签
   */
  tags?: string[];
  /**
   * 插件分类
   */
  category?: string;
  /**
   * 是否默认启用
   */
  enabledByDefault?: boolean;
}

/**
 * 插件上下文
 */
export interface PluginContext {
  /**
   * 插件名称
   */
  pluginName: string;
  /**
   * 插件目录
   */
  pluginDir: string;
  /**
   * 应用根目录
   */
  appRoot: string;
  /**
   * 配置获取方法
   */
  getConfig: <T>(key: string, defaultValue?: T) => T;
  /**
   * 配置设置方法
   */
  setConfig: <T>(key: string, value: T) => void;
  /**
   * 日志方法
   */
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void;
  /**
   * 工具注册方法
   */
  registerTool: (tool: any) => void;
  /**
   * 命令注册方法
   */
  registerCommand: (command: any) => void;
}

/**
 * 插件接口
 */
export interface Plugin {
  /**
   * 插件元数据
   */
  metadata: PluginMetadata;
  /**
   * 插件状态
   */
  status: PluginStatus;
  /**
   * 插件初始化
   */
  initialize: (context: PluginContext) => Promise<void>;
  /**
   * 插件启动
   */
  start?: () => Promise<void>;
  /**
   * 插件停止
   */
  stop?: () => Promise<void>;
  /**
   * 插件卸载
   */
  unload?: () => Promise<void>;
  /**
   * 插件错误
   */
  error?: Error;
}

/**
 * 插件清单
 */
export interface PluginManifest {
  /**
   * 插件名称
   */
  name: string;
  /**
   * 插件版本
   */
  version: string;
  /**
   * 插件描述
   */
  description: string;
  /**
   * 插件作者
   */
  author?: {
    name: string;
    email?: string;
  };
  /**
   * 插件关键词
   */
  keywords?: string[];
  /**
   * 插件主页
   */
  homepage?: string;
  /**
   * 插件命令
   */
  commands?: string[];
  /**
   * 插件代理
   */
  agents?: string[];
  /**
   * 插件技能
   */
  skills?: string[];
  /**
   * 插件钩子
   */
  hooks?: string;
  /**
   * MCP服务器
   */
  mcpServers?: string;
  /**
   * LSP服务器
   */
  lspServers?: string;
  /**
   * 插件入口点
   */
  main?: string;
  /**
   * 插件依赖
   */
  dependencies?: PluginDependency[];
  /**
   * 插件配置
   */
  config?: Record<string, unknown>;
  /**
   * 插件权限
   */
  permissions?: string[];
}
