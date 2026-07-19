/**
 * MCP名称规范化
 * 负责MCP工具/服务器名称的标准化处理
 * */

import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'mcp:normalization',
  level: LogLevel.INFO,
});

const CLAUDEAI_SERVER_PREFIX = 'claude.ai ';
const NON_ALPHANUMERIC = /[^a-zA-Z0-9_-]/g;
const CONSECUTIVE_UNDERSCORES = /_+/g;

/**
 * 将名称规范化为MCP兼容格式
 * 对claude.ai前缀的服务器名称特殊处理（折叠连续下划线）
 */
export function normalizeNameForMCP(name: string): string {
  let normalized = name.replace(NON_ALPHANUMERIC, '_').toLowerCase();

  if (name.startsWith(CLAUDEAI_SERVER_PREFIX)) {
    normalized = normalized
      .replace(CONSECUTIVE_UNDERSCORES, '_')
      .replace(/^_|_$/g, '');
  }

  return normalized;
}

/**
 * 检查名称是否需要规范化
 */
export function needsNormalization(name: string): boolean {
  return !/^[a-zA-Z0-9_-]{1,64}$/.test(name);
}

/**
 * 规范化MCP工具名称（单参数版本）
 * 将任何无效字符替换为下划线，并去除前导下划线
 */
export function normalizeSimpleToolName(name: string): string {
  let normalized = name.replace(/[^a-zA-Z0-9_]/g, '_');
  normalized = normalized.replace(/^_+/, '');
  return normalized;
}

/**
 * 规范化MCP工具完整名称（双参数版本）
 * 返回 `mcp__${serverName}__${toolName}` 格式
 */
export function normalizeToolName(
  serverName: string,
  toolName: string
): string {
  const normalizedServer = normalizeNameForMCP(serverName);
  const normalizedTool = normalizeNameForMCP(toolName);
  return `mcp__${normalizedServer}__${normalizedTool}`;
}

export function normalizeCommandName(
  serverName: string,
  commandName: string
): string {
  const normalizedServer = normalizeNameForMCP(serverName);
  const normalizedCommand = normalizeNameForMCP(commandName);
  return `mcp__${normalizedServer}__${normalizedCommand}`;
}

export function normalizeResourceUri(serverName: string, uri: string): string {
  try {
    const parsed = new URL(uri);
    return `${parsed.protocol}//${normalizeNameForMCP(serverName)}${parsed.pathname}${parsed.search}`;
  } catch {
    logger.debug('MCP resource URI normalization fallback', { uri });
    return uri;
  }
}

/**
 * 规范化资源URI（单参数版本）
 * 确保URI包含协议前缀
 */
export function normalizeSimpleResourceUri(uri: string): string {
  if (!uri.includes('://')) {
    return `file://${uri}`;
  }
  return uri;
}

export function denormalizeMcpName(normalizedName: string): string {
  return normalizedName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isValidMcpName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}
