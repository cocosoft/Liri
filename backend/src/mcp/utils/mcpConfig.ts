/**
 * MCP配置管理
 * 负责加载和保存MCP服务器配置
 * 标准配置管理请参考 services/mcp/config.ts MCPConfigManager
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { logger } from '@modules/utils/log';
import { MCPServerConfig, ScopedMcpServerConfig } from '../types';

/**
 * 读取MCP配置
 */
export function readMcpConfig(
  configPath: string
): Record<string, MCPServerConfig> {
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const content = readFileSync(configPath, 'utf8');
    const config = JSON.parse(content);
    return config.mcpServers || {};
  } catch (error) {
    logger.error('Failed to read MCP config', error instanceof Error ? error : new Error(String(error)), { configPath });
    return {};
  }
}

/**
 * 写入MCP配置
 */
export function writeMcpConfig(
  configPath: string,
  servers: Record<string, MCPServerConfig>
): void {
  try {
    let fullConfig: any = {};

    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf8');
      fullConfig = JSON.parse(content);
    }

    fullConfig.mcpServers = servers;
    writeFileSync(configPath, JSON.stringify(fullConfig, null, 2));
  } catch (error) {
    logger.error('Failed to write MCP config', error instanceof Error ? error : new Error(String(error)), { configPath });
  }
}

/**
 * 添加MCP服务器配置
 */
export function addMcpServer(
  configPath: string,
  name: string,
  server: MCPServerConfig
): void {
  const servers = readMcpConfig(configPath);
  servers[name] = server;
  writeMcpConfig(configPath, servers);
}

/**
 * 删除MCP服务器配置
 */
export function removeMcpServer(configPath: string, name: string): void {
  const servers = readMcpConfig(configPath);
  delete servers[name];
  writeMcpConfig(configPath, servers);
}

/**
 * 更新MCP服务器配置
 */
export function updateMcpServer(
  configPath: string,
  name: string,
  server: MCPServerConfig
): void {
  addMcpServer(configPath, name, server);
}

/**
 * 获取MCP服务器配置
 */
export function getMcpServer(
  configPath: string,
  name: string
): MCPServerConfig | undefined {
  const servers = readMcpConfig(configPath);
  return servers[name];
}

/**
 * 列出所有MCP服务器配置
 */
export function listMcpServers(configPath: string): string[] {
  const servers = readMcpConfig(configPath);
  return Object.keys(servers);
}

/**
 * 验证MCP服务器配置
 */
export function validateMcpServerConfig(config: MCPServerConfig): boolean {
  if (!config) {
    return false;
  }

  const type = config.type || 'stdio';

  switch (type) {
    case 'stdio':
      return !!config.command;
    case 'sse':
    case 'http':
    case 'ws':
      return !!config.url;
    default:
      return true;
  }
}

/**
 * 从环境变量加载MCP配置
 */
export function loadMcpConfigFromEnv(): Record<string, MCPServerConfig> {
  const servers: Record<string, MCPServerConfig> = {};
  const mcpConfigEnv = process.env.MCP_SERVERS;

  if (mcpConfigEnv) {
    try {
      const config = JSON.parse(mcpConfigEnv);
      if (typeof config === 'object' && config !== null) {
        for (const [name, serverConfig] of Object.entries(config)) {
          if (validateMcpServerConfig(serverConfig as MCPServerConfig)) {
            servers[name] = serverConfig as MCPServerConfig;
          }
        }
      }
    } catch (error) {
      logger.error('Failed to parse MCP_SERVERS environment variable', error instanceof Error ? error : new Error(String(error)));
    }
  }

  return servers;
}

/**
 * 合并MCP配置
 */
export function mergeMcpConfigs(
  ...configs: Array<Record<string, MCPServerConfig>>
): Record<string, MCPServerConfig> {
  const merged: Record<string, MCPServerConfig> = {};

  for (const config of configs) {
    Object.assign(merged, config);
  }

  return merged;
}
