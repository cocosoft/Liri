/**
 * 插件类型定义（2026-08-29 类型中心收缩）
 *
 * 仅保留有真实消费方的类型：
 *   - LoadedPlugin：re-export @modules/plugins/types/PluginTypes（loadPluginAgents/AppState 消费）
 *   - PluginError：re-export @modules/error（AppState 消费）
 *   - PluginManifest/PluginHooks/PluginMcpServer：plugins/types/PluginTypes.ts 消费 PluginManifest
 *
 * 已删除零消费 interface（PluginLoader/PluginRegistry/PluginManager/PluginSource/
 * CommandMetadata/BuiltinPluginDefinition/PluginSourceType）——插件领域事实类型在
 * @modules/plugins/types（class 实现）与 plugins/utils/schemas（zod 校验事实源）。
 */

// === 从 PluginTypes 导入并重导出核心类型 ===
import type { LoadedPlugin } from '@modules/plugins/types/PluginTypes.js';
export type { LoadedPlugin };

import { PluginError } from '@modules/error';
export { PluginError };

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
