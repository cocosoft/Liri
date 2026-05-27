/**
 * MCP配置管理（委托层）
 * 所有实际实现委托到 EnhancedMCPConfigManager（services/mcp/）
 */

import { MCPServerConfig } from '../types';
import {
  enhancedMcpConfigManager,
  EnhancedMCPConfigManager,
} from '@modules/services/mcp/EnhancedMCPConfigManager.js';

/**
 * 读取MCP配置
 */
export function readMcpConfig(
  configPath: string
): Record<string, MCPServerConfig> {
  return enhancedMcpConfigManager.readRawConfig(configPath);
}

/**
 * 写入MCP配置
 */
export function writeMcpConfig(
  configPath: string,
  servers: Record<string, MCPServerConfig>
): void {
  enhancedMcpConfigManager.writeRawConfig(configPath, servers);
}

/**
 * 添加MCP服务器配置
 */
export function addMcpServer(
  configPath: string,
  name: string,
  server: MCPServerConfig
): void {
  const servers = enhancedMcpConfigManager.readRawConfig(configPath);
  servers[name] = server;
  enhancedMcpConfigManager.writeRawConfig(configPath, servers);
}

/**
 * 删除MCP服务器配置
 */
export function removeMcpServer(configPath: string, name: string): void {
  const servers = enhancedMcpConfigManager.readRawConfig(configPath);
  delete servers[name];
  enhancedMcpConfigManager.writeRawConfig(configPath, servers);
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
  const servers = enhancedMcpConfigManager.readRawConfig(configPath);
  return servers[name];
}

/**
 * 列出所有MCP服务器配置
 */
export function listMcpServers(configPath: string): string[] {
  const servers = enhancedMcpConfigManager.readRawConfig(configPath);
  return Object.keys(servers);
}

/**
 * 验证MCP服务器配置
 */
export function validateMcpServerConfig(config: MCPServerConfig): boolean {
  return enhancedMcpConfigManager.validateConfig(config).valid;
}

/**
 * 从环境变量加载MCP配置
 */
export function loadMcpConfigFromEnv(): Record<string, MCPServerConfig> {
  return enhancedMcpConfigManager.loadMcpConfigFromEnv();
}

/**
 * 合并MCP配置
 */
export function mergeMcpConfigs(
  ...configs: Array<Record<string, MCPServerConfig>>
): Record<string, MCPServerConfig> {
  return EnhancedMCPConfigManager.mergeMcpConfigs(...configs);
}
