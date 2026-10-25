/**
 * 插件类型定义
 *
 * 沿革：曾 re-export LoadedPlugin（← plugins/types/PluginTypes）与 PluginError（← error）；
 * 现两类型已由消费方直连事实源，本模块不再转出 ⇒ 无出向依赖，故可归 core 层（台账 D-51）。
 */

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
  /**
   * T25-08 P2：**能力声明**（`plugins/utils/pluginCapabilities.ts` 的闭合集合）。
   *
   * `LoadedPlugin.manifest` 落的就是 `plugin.json` 解析结果 ⇒ 这里必须有，否则读取清单能力
   * 只能靠类型断言（能力闸与市场页展示都要读它）。
   */
  capabilities?: string[];
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
