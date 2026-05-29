import * as fs from 'fs';
import * as path from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { resolvePyappHome } from '@modules/config/paths';
import { enhancedMcpConfigManager } from '@modules/services/mcp/EnhancedMCPConfigManager';
import type { ScopedMcpServerConfig, MCPServerConfig } from '@modules/services/mcp/types';
import type { ServerInstallConfig } from './types';

const logger = new Logger({ level: LogLevel.INFO });

export class ConfigWriter {
  /**
   * 安装 MCP 服务器：写入配置 + 触发连接
   */
  async install(name: string, config: ServerInstallConfig): Promise<void> {
    try {
      this.backupConfig();

      const mcpConfig: ScopedMcpServerConfig = {
        command: config.command,
        args: config.args,
        env: config.env,
        scope: 'user',
      };

      const userConfigPath = path.join(resolvePyappHome(), 'user', 'mcp.json');
      const servers = enhancedMcpConfigManager.readRawConfig(userConfigPath);

      servers[name] = { command: config.command, args: config.args, env: config.env };
      enhancedMcpConfigManager.writeRawConfig(userConfigPath, servers);

      enhancedMcpConfigManager.addConfig(name, mcpConfig);

      logger.info(`MCP 服务器安装配置已写入: ${name}`);
    } catch (error) {
      logger.error(`写入 MCP 服务器配置失败: ${name}`, error as Error);
      throw new Error(`安装失败: 无法写入配置 - ${(error as Error).message}`);
    }
  }

  /**
   * 卸载 MCP 服务器：删除配置
   */
  async uninstall(name: string): Promise<void> {
    try {
      this.backupConfig();

      const userConfigPath = path.join(resolvePyappHome(), 'user', 'mcp.json');
      const servers = enhancedMcpConfigManager.readRawConfig(userConfigPath);

      delete servers[name];
      enhancedMcpConfigManager.writeRawConfig(userConfigPath, servers);

      enhancedMcpConfigManager.removeConfig(name);

      logger.info(`MCP 服务器配置已删除: ${name}`);
    } catch (error) {
      logger.error(`删除 MCP 服务器配置失败: ${name}`, error as Error);
      throw new Error(`卸载失败: 无法删除配置 - ${(error as Error).message}`);
    }
  }

  /**
   * 启用/禁用 MCP 服务器
   */
  async toggle(name: string, enabled: boolean): Promise<void> {
    const userConfigPath = path.join(resolvePyappHome(), 'user', 'mcp.json');
    const servers = enhancedMcpConfigManager.readRawConfig(userConfigPath) as Record<string, MCPServerConfig & { disabled?: boolean }>;

    if (servers[name]) {
      servers[name].disabled = !enabled;
      enhancedMcpConfigManager.writeRawConfig(userConfigPath, servers);
    }
  }

  /**
   * 备份当前配置
   */
  private backupConfig(): void {
    const configPath = path.join(resolvePyappHome(), 'user', 'mcp.json');

    if (fs.existsSync(configPath)) {
      const backupPath = configPath + '.bak';

      try {
        fs.copyFileSync(configPath, backupPath);
      } catch (error) {
        logger.warn('备份 MCP 配置文件失败', error as Error);
      }
    }
  }
}
