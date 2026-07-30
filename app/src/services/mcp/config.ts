/**
 * MCP配置管理
 * 负责加载、验证和管理MCP服务器配置
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolvePyappHome, resolveProjectRoot } from '@modules/core';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = new Logger({
  module: 'services:mcp:config',
  level: LogLevel.INFO,
});
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
      handleError(error, {
        module: 'services:mcp:config',
        action: '加载MCP配置失败',
      });
      return {};
    }
  }

  /**
   * 加载全局配置
   */
  private loadGlobalConfig(): Record<string, ScopedMcpServerConfig> {
    const globalConfigPath = path.join(resolvePyappHome(), 'mcp.json');
    return this.loadConfigFile(globalConfigPath, 'local');
  }

  /**
   * 加载用户配置
   */
  private loadUserConfig(): Record<string, ScopedMcpServerConfig> {
    const userConfigPath = path.join(resolvePyappHome(), 'user', 'mcp.json');
    return this.loadConfigFile(userConfigPath, 'user');
  }

  /**
   * 加载项目配置
   */
  private loadProjectConfig(): Record<string, ScopedMcpServerConfig> {
    const projectConfigPath = path.join(resolveProjectRoot(), '.mcp.json');
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
      handleError(error, {
        module: 'services:mcp:config',
        action: '加载MCP配置文件失败',
      });
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
      handleError(error, {
        module: 'services:mcp:config',
        action: '验证MCP配置失败',
      });
      return false;
    }
  }
}

// 导出单例
export const mcpConfigManager = new MCPConfigManager();
