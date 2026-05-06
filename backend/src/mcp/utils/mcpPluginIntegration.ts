/**
 * MCP插件集成
 * 负责从插件加载MCP服务器配置并处理环境变量
 */

import { join } from 'path';
import {
  MCPServerConfig,
  ScopedMcpServerConfig,
  UserConfigValues,
  UserConfigSchema,
} from '../types';
import type { LoadedPlugin, PluginError } from '@modules/plugins/types';

/**
 * 未配置的通道
 */
export type UnconfiguredChannel = {
  server: string;
  displayName: string;
  configSchema: UserConfigSchema;
};

/**
 * 从插件加载MCP服务器配置
 */
export async function loadPluginMcpServers(
  plugin: LoadedPlugin,
  errors: PluginError[] = []
): Promise<Record<string, MCPServerConfig> | undefined> {
  let servers: Record<string, MCPServerConfig> = {};

  // 检查插件目录中的.mcp.json文件（最低优先级）
  const defaultMcpServers = await loadMcpServersFromFile(
    plugin.path,
    '.mcp.json'
  );
  if (defaultMcpServers) {
    servers = { ...servers, ...defaultMcpServers };
  }

  // 处理插件manifest中的mcpServers配置（更高优先级）
  if (plugin.manifest.mcpServers) {
    const mcpServersSpec = plugin.manifest.mcpServers;

    // 处理不同的mcpServers格式
    if (typeof mcpServersSpec === 'string') {
      // 检查是否是MCPB文件
      if (isMcpbSource(mcpServersSpec)) {
        const mcpbServers = await loadMcpServersFromMcpb(
          plugin,
          mcpServersSpec,
          errors
        );
        if (mcpbServers) {
          servers = { ...servers, ...mcpbServers };
        }
      } else {
        // 路径到JSON文件
        const mcpServers = await loadMcpServersFromFile(
          plugin.path,
          mcpServersSpec
        );
        if (mcpServers) {
          servers = { ...servers, ...mcpServers };
        }
      }
    } else if (Array.isArray(mcpServersSpec)) {
      // 路径或内联配置数组
      const results = await Promise.all(
        mcpServersSpec.map(async (spec) => {
          try {
            if (typeof spec === 'string') {
              // 检查是否是MCPB文件
              if (isMcpbSource(spec)) {
                return await loadMcpServersFromMcpb(plugin, spec, errors);
              }
              // 路径到JSON文件
              return await loadMcpServersFromFile(plugin.path, spec);
            }
            // 内联MCP服务器配置
            return spec;
          } catch (e) {
            console.error(
              `Failed to load MCP servers from spec for plugin ${plugin.name}: ${e}`
            );
            return null;
          }
        })
      );
      for (const result of results) {
        if (result) {
          servers = { ...servers, ...result };
        }
      }
    } else {
      // 直接MCP服务器配置
      servers = { ...servers, ...mcpServersSpec };
    }
  }

  return Object.keys(servers).length > 0 ? servers : undefined;
}

/**
 * 从JSON文件加载MCP服务器配置
 */
async function loadMcpServersFromFile(
  pluginPath: string,
  relativePath: string
): Promise<Record<string, MCPServerConfig> | null> {
  try {
    const fs = await import('fs/promises');
    const filePath = join(pluginPath, relativePath);
    const content = await fs.readFile(filePath, { encoding: 'utf-8' });
    const parsed = JSON.parse(content);

    // 检查是否是.mcp.json格式，带有mcpServers键
    const mcpServers = parsed.mcpServers || parsed;

    // 验证每个服务器配置
    const validatedServers: Record<string, MCPServerConfig> = {};
    for (const [name, config] of Object.entries(mcpServers)) {
      validatedServers[name] = config as MCPServerConfig;
    }

    return validatedServers;
  } catch (error) {
    console.error(`Failed to load MCP servers from file: ${error}`);
    return null;
  }
}

/**
 * 从MCPB文件加载MCP服务器配置
 */
async function loadMcpServersFromMcpb(
  plugin: LoadedPlugin,
  mcpbPath: string,
  errors: PluginError[]
): Promise<Record<string, MCPServerConfig> | null> {
  try {
    console.log(`Loading MCP servers from MCPB: ${mcpbPath}`);

    // 这里应该实现MCPB文件的加载逻辑
    // 暂时返回一个模拟结果
    const serverName = 'mcpb_server';
    const mcpConfig: MCPServerConfig = {
      type: 'stdio',
      command: 'python mcp_server.py',
    };

    return { [serverName]: mcpConfig };
  } catch (error) {
    console.error(`Failed to load MCPB ${mcpbPath}: ${error}`);

    // 添加错误信息
    errors.push({
      type: 'generic-error',
      source: `${plugin.name}@${plugin.repository}`,
      plugin: plugin.name,
      error: `Failed to load MCPB ${mcpbPath}: ${error instanceof Error ? error.message : String(error)}`,
    });

    return null;
  }
}

/**
 * 检查是否是MCPB源
 */
function isMcpbSource(source: string): boolean {
  return source.endsWith('.mcpb') || source.startsWith('http');
}

/**
 * 为插件MCP服务器添加作用域前缀
 */
export function addPluginScopeToServers(
  servers: Record<string, MCPServerConfig>,
  pluginName: string,
  pluginSource: string
): Record<string, ScopedMcpServerConfig> {
  const scopedServers: Record<string, ScopedMcpServerConfig> = {};

  for (const [name, config] of Object.entries(servers)) {
    // 为服务器名称添加插件前缀，避免冲突
    const scopedName = `plugin:${pluginName}:${name}`;
    const scoped: ScopedMcpServerConfig = {
      ...config,
      scope: 'dynamic', // 为插件服务器使用动态作用域
      pluginSource,
    };
    scopedServers[scopedName] = scoped;
  }

  return scopedServers;
}

/**
 * 解析插件MCP服务器的环境变量
 */
export function resolvePluginMcpEnvironment(
  config: MCPServerConfig,
  plugin: { path: string; source: string },
  userConfig?: UserConfigValues,
  errors?: PluginError[],
  pluginName?: string,
  serverName?: string
): MCPServerConfig {
  const allMissingVars: string[] = [];

  const resolveValue = (value: string): string => {
    // 首先替换插件特定变量
    let resolved = substitutePluginVariables(value, plugin);

    // 然后替换用户配置变量（如果提供）
    if (userConfig) {
      resolved = substituteUserConfigVariables(resolved, userConfig);
    }

    // 最后展开通用环境变量
    const { expanded, missingVars } = expandEnvVarsInString(resolved);
    allMissingVars.push(...missingVars);

    return expanded;
  };

  let resolved: MCPServerConfig;

  // 处理不同的服务器类型
  switch (config.type) {
    case undefined:
    case 'stdio': {
      const stdioConfig = { ...config };

      // 解析命令路径
      if (stdioConfig.command) {
        stdioConfig.command = resolveValue(stdioConfig.command);
      }

      // 解析参数
      if (stdioConfig.args) {
        stdioConfig.args = stdioConfig.args.map((arg) => resolveValue(arg));
      }

      // 解析环境变量并添加插件根目录
      const resolvedEnv: Record<string, string> = {
        PY_APP_PLUGIN_ROOT: plugin.path,
        ...(stdioConfig.env || {}),
      };
      for (const [key, value] of Object.entries(resolvedEnv)) {
        if (key !== 'PY_APP_PLUGIN_ROOT') {
          resolvedEnv[key] = resolveValue(value);
        }
      }
      stdioConfig.env = resolvedEnv;

      resolved = stdioConfig;
      break;
    }

    case 'sse':
    case 'http':
    case 'ws': {
      const remoteConfig = { ...config };

      // 解析URL
      if (remoteConfig.url) {
        remoteConfig.url = resolveValue(remoteConfig.url);
      }

      // 解析头部
      if (remoteConfig.headers) {
        const resolvedHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(remoteConfig.headers)) {
          resolvedHeaders[key] = resolveValue(value);
        }
        remoteConfig.headers = resolvedHeaders;
      }

      resolved = remoteConfig;
      break;
    }

    // 对于其他类型（sse-ide, ws-ide, sdk, claudeai-proxy），直接传递
    case 'sse-ide':
    case 'ws-ide':
    case 'sdk':
    case 'claudeai-proxy':
      resolved = config;
      break;

    default:
      resolved = config;
  }

  // 记录和跟踪缺失的变量
  if (errors && allMissingVars.length > 0) {
    const uniqueMissingVars = [...new Set(allMissingVars)];
    const varList = uniqueMissingVars.join(', ');

    console.warn(
      `Missing environment variables in plugin MCP config: ${varList}`
    );

    // 如果提供了插件和服务器名称，添加错误到错误数组
    if (pluginName && serverName) {
      errors.push({
        type: 'generic-error',
        source: `plugin:${pluginName}`,
        plugin: pluginName,
        error: `Missing environment variables in MCP server ${serverName}: ${varList}`,
      });
    }
  }

  return resolved;
}

/**
 * 替换插件特定变量
 */
function substitutePluginVariables(
  value: string,
  plugin: { path: string }
): string {
  return value.replace(/\$\{PY_APP_PLUGIN_ROOT\}/g, plugin.path);
}

/**
 * 替换用户配置变量
 */
function substituteUserConfigVariables(
  value: string,
  userConfig: UserConfigValues
): string {
  return value.replace(/\$\{user_config\.([^}]+)\}/g, (match, key) => {
    const value = userConfig[key];
    return value !== undefined ? String(value) : match;
  });
}

/**
 * 展开环境变量
 */
function expandEnvVarsInString(value: string): {
  expanded: string;
  missingVars: string[];
} {
  const missingVars: string[] = [];

  const expanded = value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    const envValue = process.env[varName];
    if (envValue === undefined) {
      missingVars.push(varName);
      return match;
    }
    return envValue;
  });

  return { expanded, missingVars };
}

/**
 * 从插件中提取MCP服务器配置
 */
export async function extractMcpServersFromPlugins(
  plugins: LoadedPlugin[],
  errors: PluginError[] = []
): Promise<Record<string, ScopedMcpServerConfig>> {
  const allServers: Record<string, ScopedMcpServerConfig> = {};

  const scopedResults = await Promise.all(
    plugins.map(async (plugin) => {
      if (!plugin.enabled) return null;

      const servers = await loadPluginMcpServers(plugin, errors);
      if (!servers) return null;

      // 解析环境变量
      const resolvedServers: Record<string, MCPServerConfig> = {};
      for (const [name, config] of Object.entries(servers)) {
        const userConfig = buildMcpUserConfig(plugin, name);
        try {
          resolvedServers[name] = resolvePluginMcpEnvironment(
            config,
            plugin,
            userConfig,
            errors,
            plugin.name,
            name
          );
        } catch (err) {
          errors?.push({
            type: 'generic-error',
            source: name,
            plugin: plugin.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // 为插件服务器添加作用域
      return addPluginScopeToServers(
        resolvedServers,
        plugin.name,
        plugin.source
      );
    })
  );

  for (const scopedServers of scopedResults) {
    if (scopedServers) {
      Object.assign(allServers, scopedServers);
    }
  }

  return allServers;
}

/**
 * 构建MCP用户配置
 */
function buildMcpUserConfig(
  plugin: LoadedPlugin,
  serverName: string
): UserConfigValues | undefined {
  // 这里应该实现从插件加载用户配置的逻辑
  // 暂时返回undefined
  return undefined;
}

/**
 * 获取未配置的通道
 */
export function getUnconfiguredChannels(
  plugin: LoadedPlugin
): UnconfiguredChannel[] {
  // 检查插件清单是否有channels属性
  const channels = (plugin.manifest as any).channels;
  if (!channels || !Array.isArray(channels) || channels.length === 0) {
    return [];
  }

  const unconfigured: UnconfiguredChannel[] = [];
  for (const channel of channels) {
    if (!channel.userConfig || Object.keys(channel.userConfig).length === 0) {
      continue;
    }
    // 这里应该实现用户配置验证逻辑
    // 暂时假设所有通道都需要配置
    unconfigured.push({
      server: channel.server,
      displayName: channel.displayName || channel.server,
      configSchema: channel.userConfig,
    });
  }
  return unconfigured;
}
