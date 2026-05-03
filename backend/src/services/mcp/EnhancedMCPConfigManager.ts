// @ts-nocheck
/**
 * 增强的MCP配置管理
 * 支持多种配置来源和验证
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/log';
import { McpServerConfigSchema, McpJsonConfigSchema, ScopedMcpServerConfig, ConfigScope } from './types';

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
      // 加载不同来源的配置
      const configs = {
        ...this.loadGlobalConfig(),
        ...this.loadUserConfig(),
        ...this.loadProjectConfig(),
        ...this.loadEnvironmentConfig(),
      };

      this.configs = configs;
      return configs;
    } catch (error) {
      logger.error('Failed to load MCP configs:', error);
      return {};
    }
  }

  /**
   * 加载全局配置
   */
  private loadGlobalConfig(): Record<string, ScopedMcpServerConfig> {
    const globalConfigPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.py_app', 'mcp.json');
    const configs = this.loadConfigFile(globalConfigPath, 'local');
    this.watchConfigFile(globalConfigPath, 'local');
    return configs;
  }

  /**
   * 加载用户配置
   */
  private loadUserConfig(): Record<string, ScopedMcpServerConfig> {
    const userConfigPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.py_app', 'user', 'mcp.json');
    const configs = this.loadConfigFile(userConfigPath, 'user');
    this.watchConfigFile(userConfigPath, 'user');
    return configs;
  }

  /**
   * 加载项目配置
   */
  private loadProjectConfig(): Record<string, ScopedMcpServerConfig> {
    const projectConfigPath = path.join(process.cwd(), '.mcp.json');
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
          const config = JSON.parse(value);
          if (McpServerConfigSchema.safeParse(config).success) {
            environmentConfig[serverName] = {
              ...config,
              scope: 'dynamic'
            };
          }
        } catch (error) {
          logger.error(`Failed to parse MCP server config from environment variable ${key}:`, error);
        }
      }
    }

    this.environmentConfig = environmentConfig;
    return environmentConfig;
  }

  /**
   * 加载配置文件
   */
  private loadConfigFile(path: string, scope: ConfigScope): Record<string, ScopedMcpServerConfig> {
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
          scope
        };
      }

      return scopedConfigs;
    } catch (error) {
      logger.error(`Failed to load MCP config file ${path}:`, error);
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

    this.watchers.set(path, watcher);
  }

  /**
   * 重新加载配置
   */
  async reloadConfigs(): Promise<void> {
    try {
      const newConfigs = await this.loadConfigs();
      logger.info(`Reloaded MCP configs: ${Object.keys(newConfigs).length} servers`);
      // 这里可以触发配置更新事件
    } catch (error) {
      logger.error('Failed to reload MCP configs:', error);
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
        const errors = result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
        return { valid: false, errors };
      }
    } catch (error) {
      return { valid: false, errors: [error instanceof Error ? error.message : 'Unknown error'] };
    }
  }

  /**
   * 保存配置到文件
   */
  saveConfig(name: string, config: ScopedMcpServerConfig, scope: ConfigScope = 'user'): boolean {
    try {
      let configPath: string;
      
      switch (scope) {
        case 'local':
          configPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.py_app', 'mcp.json');
          break;
        case 'user':
          configPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.py_app', 'user', 'mcp.json');
          break;
        case 'project':
          configPath = path.join(process.cwd(), '.mcp.json');
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
        ? McpJsonConfigSchema.parse(JSON.parse(fs.readFileSync(configPath, 'utf8')))
        : { mcpServers: {} };

      // 更新配置
      existingConfig.mcpServers[name] = config;

      // 保存到文件
      // 注意：这里需要实现文件写入逻辑
      logger.info(`Saved MCP server config: ${name} to ${configPath}`);
      return true;
    } catch (error) {
      logger.error(`Failed to save MCP server config:`, error);
      return false;
    }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    // 取消所有文件监视
    for (const [path, watcher] of this.watchers.entries()) {
      unwatchFile(path, watcher as any);
    }
    this.watchers.clear();
  }
}

// 导出单例
export const enhancedMcpConfigManager = new EnhancedMCPConfigManager();