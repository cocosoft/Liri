/**
 * MCP 服务器策略管理
 *
 * 安全域：策略
 * 目标位置：security/policy/
 *
 * 负责 MCP 服务器的策略过滤、企业配置检测、命令/资源配置过滤。
 */

import { configManager } from '@modules/config';

export interface MCPServerPolicy {
  allowedServers?: string[];
  blockedServers?: string[];
  allowAll?: boolean;
}

export function filterMcpServersByPolicy(
  serverNames: string[],
  policy?: MCPServerPolicy
): string[] {
  if (!policy || policy.allowAll) return serverNames;

  let filtered = serverNames;

  if (policy.allowedServers && policy.allowedServers.length > 0) {
    const allowed = new Set(policy.allowedServers);
    filtered = filtered.filter((n) => allowed.has(n));
  }

  if (policy.blockedServers && policy.blockedServers.length > 0) {
    const blocked = new Set(policy.blockedServers);
    filtered = filtered.filter((n) => !blocked.has(n));
  }

  return filtered;
}

export function doesEnterpriseMcpConfigExist(): boolean {
  return configManager.env('Liri_ENTERPRISE_MCP_CONFIG') === 'true';
}

export function excludeCommandsByServer(
  serverName: string,
  commands: string[],
  excluded: Record<string, string[]>
): string[] {
  const exclusions = excluded[serverName] || [];
  const excludeSet = new Set(exclusions);
  return commands.filter((c) => !excludeSet.has(c));
}

export function excludeResourcesByServer(
  serverName: string,
  resources: string[],
  excluded: Record<string, string[]>
): string[] {
  const exclusions = excluded[serverName] || [];
  const excludeSet = new Set(exclusions);
  return resources.filter((r) => !excludeSet.has(r));
}
