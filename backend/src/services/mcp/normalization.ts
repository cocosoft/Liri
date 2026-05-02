/**
 * MCP名称规范化
 * 负责MCP工具/服务器名称的标准化处理
 *
 * 基于CC源码 cc_code/backend/services/mcp/normalization.ts 实现
 */

const NON_ALPHANUMERIC = /[^a-zA-Z0-9]/g;
const CONSECUTIVE_UNDERSCORES = /_+/g;

export function normalizeNameForMCP(name: string): string {
  return name
    .replace(NON_ALPHANUMERIC, '_')
    .replace(CONSECUTIVE_UNDERSCORES, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

export function normalizeToolName(serverName: string, toolName: string): string {
  const normalizedServer = normalizeNameForMCP(serverName);
  const normalizedTool = normalizeNameForMCP(toolName);
  return `mcp__${normalizedServer}__${normalizedTool}`;
}

export function normalizeCommandName(serverName: string, commandName: string): string {
  const normalizedServer = normalizeNameForMCP(serverName);
  const normalizedCommand = normalizeNameForMCP(commandName);
  return `mcp__${normalizedServer}__${normalizedCommand}`;
}

export function normalizeResourceUri(serverName: string, uri: string): string {
  try {
    const parsed = new URL(uri);
    return `${parsed.protocol}//${normalizeNameForMCP(serverName)}${parsed.pathname}${parsed.search}`;
  } catch {
    return uri;
  }
}

export function denormalizeMcpName(normalizedName: string): string {
  return normalizedName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function isValidMcpName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}
