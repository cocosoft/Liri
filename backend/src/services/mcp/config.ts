//
/**
 * MCP配置管理
 * 负责加载、验证和管理MCP服务器配置
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@modules/utils/log';
import {
  McpServerConfigSchema,
  McpJsonConfigSchema,
  ScopedMcpServerConfig,
  ConfigScope,
} from './types';

/**
 * MCP配置管理
 */
export class MCPConfigManager {
  private configs: Record<string, ScopedMcpServerConfig> = {};

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
      };

      this.configs = configs;
      return configs;
    } catch (error) {
      logger.error(
        'Failed to load MCP configs:',
        error instanceof Error ? error : new Error(String(error))
      );
      return {};
    }
  }

  /**
   * 加载全局配置
   */
  private loadGlobalConfig(): Record<string, ScopedMcpServerConfig> {
    const globalConfigPath = path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      '.py_app',
      'mcp.json'
    );
    return this.loadConfigFile(globalConfigPath, 'local');
  }

  /**
   * 加载用户配置
   */
  private loadUserConfig(): Record<string, ScopedMcpServerConfig> {
    const userConfigPath = path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      '.py_app',
      'user',
      'mcp.json'
    );
    return this.loadConfigFile(userConfigPath, 'user');
  }

  /**
   * 加载项目配置
   */
  private loadProjectConfig(): Record<string, ScopedMcpServerConfig> {
    const projectConfigPath = path.join(process.cwd(), '.mcp.json');
    return this.loadConfigFile(projectConfigPath, 'project');
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
      logger.error(
        `Failed to load MCP config file ${path}:`,
        error instanceof Error ? error : new Error(String(error))
      );
      return {};
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
  }

  /**
   * 删除配置
   */
  removeConfig(name: string): void {
    delete this.configs[name];
  }

  /**
   * 验证配置
   */
  validateConfig(config: any): boolean {
    try {
      McpServerConfigSchema.parse(config);
      return true;
    } catch (error) {
      logger.error(
        'Invalid MCP config:',
        error instanceof Error ? error : new Error(String(error))
      );
      return false;
    }
  }
}

// 导出单例
export const mcpConfigManager = new MCPConfigManager();
