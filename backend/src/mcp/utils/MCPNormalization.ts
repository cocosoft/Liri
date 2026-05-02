/**
 * MCP名称规范化工具
 * 提供MCP服务器名称规范化为API兼容格式的纯函数
 * 参考CC源码 cc_code/backend/services/mcp/normalization.ts 实现
 */

const CLAUDEAI_SERVER_PREFIX = 'claude.ai ';

/**
 * 将服务器名称规范化为与API模式 ^[a-zA-Z0-9_-]{1,64}$ 兼容的格式
 * 将任何无效字符（包括点和空格）替换为下划线
 * 对于以"claude.ai "开头的服务器名称，还会折叠连续的下划线并去除首尾下划线
 * 以防止与MCP工具名称中使用的__分隔符干扰
 */
export function normalizeNameForMCP(name: string): string {
  let normalized = name.replace(/[^a-zA-Z0-9_-]/g, '_');

  if (name.startsWith(CLAUDEAI_SERVER_PREFIX)) {
    normalized = normalized.replace(/_+/g, '_').replace(/^_|_$/g, '');
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
 * 规范化MCP工具名称
 * 将任何无效字符替换为下划线，并确保不以双下划线开头
 */
export function normalizeToolName(name: string): string {
  let normalized = name.replace(/[^a-zA-Z0-9_]/g, '_');
  normalized = normalized.replace(/^_+/, '');
  return normalized;
}

/**
 * 规范化资源URI
 * 确保URI格式正确
 */
export function normalizeResourceUri(uri: string): string {
  if (!uri.includes('://')) {
    return `file://${uri}`;
  }
  return uri;
}
