/**
 * 插件类型定义（P0 类型统一 — 从 @modules/plugins/types/PluginTypes 引用核心类型）
 */

// === 从 PluginTypes 导入并重导出核心类型 ===
import type { LoadedPlugin } from '@modules/plugins/types/PluginTypes.js';
export type { LoadedPlugin };

import { PluginError } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'types\plugin', level: LogLevel.INFO });
export { PluginError };

// ====================================

/**
 * 插件清单
 */
export interface PluginManifest {
  name: string;
  description: string;
  version: string;
  author?: string;
  license?: string;
  dependencies?: string[];
  skills?: string[];
  configSchema?: Record<string, unknown>;
  commandsPath?: string;
  commandsPaths?: string[];
  agentsPath?: string;
  agentsPaths?: string[];
  skillsPath?: string;
  skillsPaths?: string[];
  outputStylesPath?: string;
  outputStylesPaths?: string[];
  hooksConfig?: PluginHooks;
  mcpServers?: PluginMcpServer[];
  settings?: Record<string, unknown>;
}

/**
 * 插件钩子配置
 */
export interface PluginHooks {
  [key: string]: unknown;
}

/**
 * 插件MCP服务器配置
 */
export interface PluginMcpServer {
  name: string;
  url: string;
  description?: string;
  [key: string]: unknown;
}

/**
 * 内置插件定义
 */
export interface BuiltinPluginDefinition {
  name: string;
  description: string;
  version: string;
  defaultEnabled?: boolean;
  isAvailable?: () => boolean;
  skills?: unknown[];
  hooks?: PluginHooks;
  mcpServers?: PluginMcpServer[];
}

/**
 * 命令元数据
 */
export interface CommandMetadata {
  name: string;
  description: string;
  aliases?: string[];
  args?: Array<{
    name: string;
    type: string;
    description: string;
    required: boolean;
    default?: any;
  }>;
  [key: string]: unknown;
}

/**
 * 插件源类型
 */
export type PluginSourceType = 'local' | 'git' | 'github' | 'npm';

/**
 * 插件源配置
 */
export interface PluginSource {
  type: PluginSourceType;
  url: string;
  version?: string;
  branch?: string;
  name?: string;
}

/**
 * 插件加载器
 */
export interface PluginLoader {
  load(pluginPath: string | PluginSource): Promise<LoadedPlugin>;
  loadAll(pluginPaths: Array<string | PluginSource>): Promise<LoadedPlugin[]>;
  clearCache(): void;
}

/**
 * 插件注册表
 */
export interface PluginRegistry {
  register(plugin: LoadedPlugin): void;
  unregister(pluginName: string): void;
  get(pluginName: string): LoadedPlugin | undefined;
  getAll(): LoadedPlugin[];
  getEnabled(): LoadedPlugin[];
  getDisabled(): LoadedPlugin[];
  clear(): void;
}

/**
 * 插件管理器
 */
export interface PluginManager {
  addPluginSource(source: PluginSource): void;
  loadPlugins(): Promise<void>;
  enablePlugin(pluginName: string): Promise<void>;
  disablePlugin(pluginName: string): Promise<void>;
  getPlugins(): { enabled: LoadedPlugin[]; disabled: LoadedPlugin[] };
  getPlugin(pluginName: string): LoadedPlugin | undefined;
  getAllPlugins(): LoadedPlugin[];
  registerBuiltinPlugin(plugin: LoadedPlugin): void;
  clearCache(): void;
}
