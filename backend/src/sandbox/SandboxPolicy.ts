/**
 * 沙箱安全策略
 * 定义工具白名单 / 黑名单，控制沙箱内可用的工具范围
 * 对齐 OpenClaw config/sessions/reset-policy.ts
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export interface SandboxToolPolicy {
  allowedTools: Set<string>;
  deniedTools: Set<string>;
  allowAll: boolean;
}

export type SandboxMode = 'host' | 'docker' | 'pty' | 'off';

export interface SandboxGlobalPolicy {
  mode: SandboxMode;
  nonMainSessions: SandboxToolPolicy;
  mainSession: SandboxToolPolicy;
  maxExecutionTimeMs: number;
  maxOutputBytes: number;
  allowInteractive: boolean;
}

const DEFAULT_ALLOWED_BASE_TOOLS = new Set([
  'bash',
  'read',
  'write',
  'edit',
  'search',
  'grep',
  'glob',
  'list_files',
  'get_file_info',
  'sessions_list',
  'sessions_history',
  'sessions_send',
  'sessions_spawn',
]);

const DEFAULT_DENIED_TOOLS = new Set([
  'browser',
  'canvas',
  'nodes',
  'cron',
  'discord',
  'gateway',
  'slack',
  'telegram',
  'web_fetch_external',
  'network_external',
]);

export function createSandboxPolicy(
  overrides: Partial<SandboxGlobalPolicy> = {}
): SandboxGlobalPolicy {
  return {
    mode: overrides.mode || 'pty',
    nonMainSessions: {
      allowedTools: new Set(DEFAULT_ALLOWED_BASE_TOOLS),
      deniedTools: new Set(DEFAULT_DENIED_TOOLS),
      allowAll: false,
      ...overrides.nonMainSessions,
    },
    mainSession: {
      allowedTools: new Set(DEFAULT_ALLOWED_BASE_TOOLS),
      deniedTools: new Set(DEFAULT_DENIED_TOOLS),
      allowAll: true,
      ...overrides.mainSession,
    },
    maxExecutionTimeMs: overrides.maxExecutionTimeMs || 300000,
    maxOutputBytes: overrides.maxOutputBytes || 1024 * 1024,
    allowInteractive: overrides.allowInteractive ?? false,
  };
}

export function isToolAllowed(
  policy: SandboxToolPolicy,
  toolName: string
): boolean {
  if (policy.allowAll) return !policy.deniedTools.has(toolName);
  return policy.allowedTools.has(toolName) && !policy.deniedTools.has(toolName);
}

export function getAllowedTools(
  policy: SandboxToolPolicy,
  availableTools: string[]
): string[] {
  return availableTools.filter((t) => isToolAllowed(policy, t));
}

export function getDeniedTools(
  policy: SandboxToolPolicy,
  availableTools: string[]
): string[] {
  return availableTools.filter((t) => !isToolAllowed(policy, t));
}

export function restrictToolSet(
  globalPolicy: SandboxGlobalPolicy,
  isMainSession: boolean
): SandboxToolPolicy {
  if (isMainSession) {
    return globalPolicy.mainSession;
  }
  return globalPolicy.nonMainSessions;
}

export function validateToolAccess(
  policy: SandboxToolPolicy,
  toolName: string
): { allowed: boolean; reason?: string } {
  if (!isToolAllowed(policy, toolName)) {
    if (policy.deniedTools.has(toolName)) {
      return { allowed: false, reason: `工具 "${toolName}" 在沙箱黑名单中` };
    }
    return { allowed: false, reason: `工具 "${toolName}" 不在沙箱白名单中` };
  }
  return { allowed: true };
}

/**
 * 默认生产环境沙箱策略（参考 OpenClaw 的安全默认值）
 */
export const PRODUCTION_SANDBOX_POLICY = createSandboxPolicy({
  mode: 'docker',
  nonMainSessions: {
    allowedTools: new Set(DEFAULT_ALLOWED_BASE_TOOLS),
    deniedTools: new Set([
      ...DEFAULT_DENIED_TOOLS,
      'browser',
      'canvas',
      'nodes',
      'cron',
      'discord',
      'gateway',
    ]),
    allowAll: false,
  },
  mainSession: {
    allowedTools: new Set(DEFAULT_ALLOWED_BASE_TOOLS),
    deniedTools: new Set(DEFAULT_DENIED_TOOLS),
    allowAll: true,
  },
  maxExecutionTimeMs: 600000,
  maxOutputBytes: 8 * 1024 * 1024,
  allowInteractive: false,
});
