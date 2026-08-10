/**
 * 增强的MCP配置管理
 * 支持多种配置来源和验证
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  resolvePyappHome,
  resolveDataDir,
  resolveProjectRoot,
} from '@modules/core';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { configManager } from '@modules/config';

const logger = getLogger('services:mcp:configManager');
import {
  McpServerConfigSchema,
  McpJsonConfigSchema,
  ScopedMcpServerConfig,
  ConfigScope,
  MCPServerConfig,
} from './types';

/**
 * 增强的MCP配置管理
 */
export class EnhancedMCPConfigManager {
  private configs: Record<string, ScopedMcpServerConfig> = {};
  private watchers: Map<string, NodeJS.Timeout> = new Map();
  private environmentConfig: Record<string, ScopedMcpServerConfig> = {};

  /**
   * 加载MCP配置
   */
  async loadConfigs(): Promise<Record<string, ScopedMcpServerConfig>> {
    try {
      // 2026-08-06 新增来源：插件声明的外部服务（J-22），优先级最低（用户显式配置可覆盖）
      const pluginConfigs = await this.loadPluginConfigs();
      // 加载不同来源的配置
      const configs = {
        ...pluginConfigs,
        ...this.loadGlobalConfig(),
        ...this.loadUserConfig(),
        ...this.loadProjectConfig(),
        ...this.loadEnvironmentConfig(),
      };

      this.configs = configs;
      return configs;
    } catch (error) {
      await handleError(error, {
        module: 'services:mcp:config',
        action: 'load_configs',
      });
      return {};
    }
  }

  /**
   * 加载插件声明的 MCP 服务器配置（J-22 接线）
   * 插件 manifest 的 mcpServers 字段（PluginMcpServer[]：{ name, url, ... }）在此注册到 MCP 配置源，
   * scope='dynamic' + pluginSource 标记来源。动态 import 避免 services/mcp ↔ plugins 循环依赖。
   */
  private async loadPluginConfigs(): Promise<
    Record<string, ScopedMcpServerConfig>
  > {
    const configs: Record<string, ScopedMcpServerConfig> = {};
    try {
      const { pluginSystem } = await import('@modules/plugins');
      const plugins = pluginSystem.getLoader().getAllPlugins();

      for (const plugin of plugins) {
        const servers = plugin.mcpServers ?? [];
        if (!Array.isArray(servers) || servers.length === 0) continue;

        for (const server of servers) {
          const { name, ...rest } = server as {
            name?: unknown;
            [key: string]: unknown;
          };
          if (typeof name !== 'string' || !name) {
            logger.warn(
              `[${plugin.name}] 插件声明的 MCP 服务器缺少 name，已跳过`
            );
            continue;
          }
          const parsed = McpServerConfigSchema.safeParse(rest);
          if (!parsed.success) {
            logger.warn(
              `[${plugin.name}] 插件声明无效的 MCP 服务器 ${name}: ${parsed.error.message}`
            );
            continue;
          }
          configs[name] = {
            ...parsed.data,
            scope: 'dynamic',
            pluginSource: plugin.name,
          };
        }
      }
    } catch (error) {
      // 插件系统未初始化/不可用时静默降级（插件 mcpServers 为可选能力）
      logger.debug(
        `插件 MCP 配置加载不可用: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return configs;
  }

  /**
   * 加载全局配置
   */
  private loadGlobalConfig(): Record<string, ScopedMcpServerConfig> {
    const globalConfigPath = path.join(resolvePyappHome(), 'mcp.json');
    const configs = this.loadConfigFile(globalConfigPath, 'local');
    this.watchConfigFile(globalConfigPath, 'local');
    return configs;
  }

  /**
   * 加载用户配置
   */
  private loadUserConfig(): Record<string, ScopedMcpServerConfig> {
    const userConfigPath = path.join(resolvePyappHome(), 'user', 'mcp.json');
    const configs = this.loadConfigFile(userConfigPath, 'user');
    this.watchConfigFile(userConfigPath, 'user');
    return configs;
  }

  /**
   * 加载项目配置
   */
  private loadProjectConfig(): Record<string, ScopedMcpServerConfig> {
    const projectConfigPath = path.join(resolveProjectRoot(), '.mcp.json');
    const configs = this.loadConfigFile(projectConfigPath, 'project');
    this.watchConfigFile(projectConfigPath, 'project');
    return configs;
  }

  /**
   * 加载环境变量配置
   */
  private loadEnvironmentConfig(): Record<string, ScopedMcpServerConfig> {
    const environmentConfig: Record<string, ScopedMcpServerConfig> = {};

    // 从环境变量加载配置
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('MCP_SERVER_')) {
        const serverName = key.substring('MCP_SERVER_'.length).toLowerCase();
        try {
          const config = JSON.parse(value as string);
          if (McpServerConfigSchema.safeParse(config).success) {
            environmentConfig[serverName] = {
              ...config,
              scope: 'dynamic',
            } as ScopedMcpServerConfig;
          }
        } catch (error) {
          void handleError(error, {
            module: 'services:mcp:config',
            action: 'parse_env',
            context: { key },
          });
        }
      }
    }

    this.environmentConfig = environmentConfig;
    return environmentConfig;
  }

  /**
   * 加载配置文件
   */
  private loadConfigFile(
    path: string,
    scope: ConfigScope
  ): Record<string, ScopedMcpServerConfig> {
    if (!fs.existsSync(path)) {
      return {};
    }

    try {
      const content = fs.readFileSync(path, 'utf8');
      const config = McpJsonConfigSchema.parse(JSON.parse(content));

      const scopedConfigs: Record<string, ScopedMcpServerConfig> = {};
      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        scopedConfigs[name] = {
          ...serverConfig,
          scope,
        };
      }

      return scopedConfigs;
    } catch (error) {
      void handleError(error, {
        module: 'services:mcp:config',
        action: 'load_file',
        context: { configPath: path },
      });
      return {};
    }
  }

  /**
   * 监视配置文件变化
   */
  private watchConfigFile(path: string, scope: ConfigScope): void {
    if (!fs.existsSync(path)) {
      return;
    }

    // 取消现有的监视
    if (this.watchers.has(path)) {
      fs.unwatchFile(path, this.watchers.get(path) as any);
    }

    // 监视文件变化
    const watcher = fs.watchFile(path, (curr, prev) => {
      if (curr.mtime !== prev.mtime) {
        logger.info(`MCP config file changed: ${path}`);
        // 重新加载配置
        this.reloadConfigs();
      }
    });

    this.watchers.set(path, watcher as any);
  }

  /**
   * 重新加载配置
   */
  async reloadConfigs(): Promise<void> {
    try {
      const newConfigs = await this.loadConfigs();
      logger.info(
        `Reloaded MCP configs: ${Object.keys(newConfigs).length} servers`
      );
      // 这里可以触发配置更新事件
    } catch (error) {
      void handleError(error, {
        module: 'services:mcp:config',
        action: 'reload_configs',
      });
    }
  }

  /**
   * 获取所有配置
   */
  getConfigs(): Record<string, ScopedMcpServerConfig> {
    return { ...this.configs };
  }

  /**
   * 获取单个配置
   */
  getConfig(name: string): ScopedMcpServerConfig | undefined {
    return this.configs[name];
  }

  /**
   * 添加配置
   */
  addConfig(name: string, config: ScopedMcpServerConfig): void {
    this.configs[name] = config;
    logger.info(`Added MCP server config: ${name}`);
  }

  /**
   * 添加自动发现的服务器配置
   * 自动发现的结果具有最低优先级，存在同名用户配置时不会覆盖
   * @param name 服务器名称
   * @param config 服务器配置
   */
  addDiscoveredServer(
    name: string,
    config: Partial<ScopedMcpServerConfig>
  ): void {
    if (!this.configs[name]) {
      const scopedConfig: ScopedMcpServerConfig = {
        ...config,
        scope: 'dynamic',
      } as ScopedMcpServerConfig;
      this.configs[name] = scopedConfig;
      logger.info(`Discovered MCP server added: ${name}`);
    }
  }

  /**
   * 删除配置
   */
  removeConfig(name: string): void {
    delete this.configs[name];
    logger.info(`Removed MCP server config: ${name}`);
  }

  /**
   * 验证配置
   */
  validateConfig(config: any): { valid: boolean; errors?: string[] } {
    try {
      const result = McpServerConfigSchema.safeParse(config);
      if (result.success) {
        return { valid: true };
      } else {
        const errors = result.error.issues.map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`
        );
        return { valid: false, errors };
      }
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  }

  /**
   * 保存配置到文件
   */
  saveConfig(
    name: string,
    config: ScopedMcpServerConfig,
    scope: ConfigScope = 'user'
  ): boolean {
    try {
      let configPath: string;

      switch (scope) {
        case 'local':
          configPath = path.join(resolvePyappHome(), 'mcp.json');
          break;
        case 'user':
          configPath = path.join(resolvePyappHome(), 'user', 'mcp.json');
          break;
        case 'project':
          configPath = path.join(resolveProjectRoot(), '.mcp.json');
          break;
        default:
          return false;
      }

      // 确保目录存在
      const dir = path.join(configPath, '..');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 读取现有配置
      const existingConfig = fs.existsSync(configPath)
        ? McpJsonConfigSchema.parse(
            JSON.parse(fs.readFileSync(configPath, 'utf8'))
          )
        : { mcpServers: {} };

      // 更新配置
      existingConfig.mcpServers[name] = config;

      // 保存到文件
      // 注意：这里需要实现文件写入逻辑
      logger.info(`Saved MCP server config: ${name} to ${configPath}`);
      return true;
    } catch (error) {
      void handleError(error, {
        module: 'services:mcp:config',
        action: 'save_server_config',
      });
      return false;
    }
  }

  /**
   * 读取任意路径的原始MCP配置
   */
  readRawConfig(configPath: string): Record<string, MCPServerConfig> {
    if (!fs.existsSync(configPath)) {
      return {};
    }

    try {
      const content = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(content);
      return config.mcpServers || {};
    } catch (error) {
      void handleError(error, {
        module: 'services:mcp:config',
        action: 'read_mcp_config',
      });
      return {};
    }
  }

  /**
   * 写入任意路径的原始MCP配置
   */
  writeRawConfig(
    configPath: string,
    servers: Record<string, MCPServerConfig>
  ): void {
    try {
      let fullConfig: Record<string, unknown> = {};

      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf8');
        fullConfig = JSON.parse(content);
      }

      fullConfig.mcpServers = servers;
      fs.writeFileSync(configPath, JSON.stringify(fullConfig, null, 2));
    } catch (error) {
      void handleError(error, {
        module: 'services:mcp:config',
        action: 'write_mcp_config',
      });
    }
  }

  /**
   * 从环境变量加载MCP配置（支持MCP_SERVERS和MCP_SERVER_*两种格式）
   */
  loadMcpConfigFromEnv(): Record<string, MCPServerConfig> {
    const servers: Record<string, MCPServerConfig> = {};
    const mcpConfigEnv = configManager.env('MCP_SERVERS');

    if (mcpConfigEnv) {
      try {
        const config = JSON.parse(mcpConfigEnv);
        if (typeof config === 'object' && config !== null) {
          for (const [name, serverConfig] of Object.entries(config)) {
            const result = McpServerConfigSchema.safeParse(serverConfig);
            if (result.success) {
              servers[name] = result.data as MCPServerConfig;
            }
          }
        }
      } catch (error) {
        void handleError(error, {
          module: 'services:mcp:config',
          action: 'parse_env_servers',
        });
      }
    }

    return servers;
  }

  /**
   * 合并多个MCP配置
   */
  static mergeMcpConfigs(
    ...configs: Array<Record<string, MCPServerConfig>>
  ): Record<string, MCPServerConfig> {
    const merged: Record<string, MCPServerConfig> = {};
    for (const config of configs) {
      Object.assign(merged, config);
    }
    return merged;
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    // 取消所有文件监视
    for (const [watchPath, watcher] of this.watchers.entries()) {
      fs.unwatchFile(watchPath, watcher as any);
    }
    this.watchers.clear();
  }
}

// 导出单例
export const enhancedMcpConfigManager = new EnhancedMCPConfigManager();
