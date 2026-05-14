/**
 * Git Safety
 * 对标CC源码 utils/bash/gitSafety.ts
 * 提供git命令安全验证，包括子命令分类、危险操作检测、仓库安全策略
 */

import type { SecurityAnalysisResult, RiskLevel, SecurityBehavior } from '../types';

export type GitSubcommandCategory = 'read' | 'write' | 'destructive' | 'admin' | 'network' | 'unknown';

export interface GitSubcommandInfo {
  name: string;
  category: GitSubcommandCategory;
  riskLevel: RiskLevel;
  description: string;
  requiresConfirmation: boolean;
}

export interface GitSafetyOptions {
  allowForcePush: boolean;
  allowHardReset: boolean;
  allowDestructiveClean: boolean;
  allowRewriteHistory: boolean;
  allowAdminOperations: boolean;
  allowNetworkOperations: boolean;
  protectedBranches: string[];
  blockedRemoteHosts: string[];
  requireGpgSignature: boolean;
  maxForcePushAgeMinutes: number;
  denySubcommands: string[];
  askSubcommands: string[];
}

export const DEFAULT_GIT_OPTIONS: GitSafetyOptions = {
  allowForcePush: false,
  allowHardReset: false,
  allowDestructiveClean: false,
  allowRewriteHistory: false,
  allowAdminOperations: false,
  allowNetworkOperations: true,
  protectedBranches: ['main', 'master', 'develop', 'production', 'release/*'],
  blockedRemoteHosts: [],
  requireGpgSignature: false,
  maxForcePushAgeMinutes: 60,
  denySubcommands: [],
  askSubcommands: [],
};

export interface GitValidationResult {
  safe: boolean;
  riskLevel: RiskLevel;
  behavior: SecurityBehavior;
  issues: GitSafetyIssue[];
  subcommandInfo?: GitSubcommandInfo;
  parsedCommand: ParsedGitCommand;
}

export interface GitSafetyIssue {
  type: GitSafetyIssueType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
}

export type GitSafetyIssueType =
  | 'destructive-operation'
  | 'force-push'
  | 'hard-reset'
  | 'history-rewrite'
  | 'protected-branch'
  | 'admin-operation'
  | 'blocked-remote'
  | 'network-operation'
  | 'unknown-subcommand';

export interface ParsedGitCommand {
  fullCommand: string;
  subcommand: string;
  args: string[];
  flags: string[];
  hasForceFlag: boolean;
  hasHardFlag: boolean;
  targetBranch?: string;
  remoteUrl?: string;
}

const GIT_SUBCOMMANDS: GitSubcommandInfo[] = [
  { name: 'status', category: 'read', riskLevel: 'low', description: 'Show working tree status', requiresConfirmation: false },
  { name: 'log', category: 'read', riskLevel: 'low', description: 'Show commit logs', requiresConfirmation: false },
  { name: 'diff', category: 'read', riskLevel: 'low', description: 'Show changes between commits', requiresConfirmation: false },
  { name: 'show', category: 'read', riskLevel: 'low', description: 'Show various types of objects', requiresConfirmation: false },
  { name: 'branch', category: 'read', riskLevel: 'low', description: 'List branches', requiresConfirmation: false },
  { name: 'tag', category: 'read', riskLevel: 'low', description: 'Create/list/delete tags', requiresConfirmation: false },
  { name: 'blame', category: 'read', riskLevel: 'low', description: 'Show file blame info', requiresConfirmation: false },
  { name: 'grep', category: 'read', riskLevel: 'low', description: 'Search repository', requiresConfirmation: false },
  { name: 'ls-tree', category: 'read', riskLevel: 'low', description: 'List tree contents', requiresConfirmation: false },
  { name: 'rev-parse', category: 'read', riskLevel: 'low', description: 'Parse revision strings', requiresConfirmation: false },
  { name: 'rev-list', category: 'read', riskLevel: 'low', description: 'List commit objects', requiresConfirmation: false },
  { name: 'reflog', category: 'read', riskLevel: 'low', description: 'Manage reflog', requiresConfirmation: false },
  { name: 'describe', category: 'read', riskLevel: 'low', description: 'Describe commit', requiresConfirmation: false },
  { name: 'shortlog', category: 'read', riskLevel: 'low', description: 'Summarize git log', requiresConfirmation: false },
  { name: 'remote', category: 'read', riskLevel: 'low', description: 'Manage tracked repositories', requiresConfirmation: false },
  { name: 'config', category: 'read', riskLevel: 'low', description: 'Get/set config', requiresConfirmation: false },
  { name: 'ls-files', category: 'read', riskLevel: 'low', description: 'List tracked files', requiresConfirmation: false },
  { name: 'help', category: 'read', riskLevel: 'low', description: 'Show help', requiresConfirmation: false },

  { name: 'add', category: 'write', riskLevel: 'low', description: 'Add file contents to index', requiresConfirmation: false },
  { name: 'commit', category: 'write', riskLevel: 'low', description: 'Record changes to repository', requiresConfirmation: false },
  { name: 'checkout', category: 'write', riskLevel: 'medium', description: 'Switch branches or restore files', requiresConfirmation: false },
  { name: 'switch', category: 'write', riskLevel: 'medium', description: 'Switch branches', requiresConfirmation: false },
  { name: 'restore', category: 'write', riskLevel: 'medium', description: 'Restore working tree files', requiresConfirmation: false },
  { name: 'merge', category: 'write', riskLevel: 'medium', description: 'Merge branches', requiresConfirmation: true },
  { name: 'rebase', category: 'write', riskLevel: 'medium', description: 'Forward-port local commits', requiresConfirmation: true },
  { name: 'stash', category: 'write', riskLevel: 'low', description: 'Stash changes', requiresConfirmation: false },
  { name: 'rm', category: 'write', riskLevel: 'medium', description: 'Remove files from repo', requiresConfirmation: true },
  { name: 'mv', category: 'write', riskLevel: 'low', description: 'Move/rename files in repo', requiresConfirmation: false },
  { name: 'fetch', category: 'network', riskLevel: 'low', description: 'Fetch from remote', requiresConfirmation: false },
  { name: 'pull', category: 'network', riskLevel: 'medium', description: 'Fetch and merge', requiresConfirmation: false },
  { name: 'push', category: 'network', riskLevel: 'medium', description: 'Push to remote', requiresConfirmation: true },
  { name: 'clone', category: 'network', riskLevel: 'medium', description: 'Clone a repository', requiresConfirmation: true },
  { name: 'submodule', category: 'write', riskLevel: 'medium', description: 'Manage submodules', requiresConfirmation: true },

  { name: 'reset', category: 'destructive', riskLevel: 'high', description: 'Reset current HEAD', requiresConfirmation: true },
  { name: 'clean', category: 'destructive', riskLevel: 'high', description: 'Remove untracked files', requiresConfirmation: true },
  { name: 'revert', category: 'destructive', riskLevel: 'high', description: 'Revert commits', requiresConfirmation: true },
  { name: 'cherry-pick', category: 'destructive', riskLevel: 'high', description: 'Cherry-pick commits', requiresConfirmation: true },
  { name: 'filter-branch', category: 'destructive', riskLevel: 'high', description: 'Rewrite branches', requiresConfirmation: true },
  { name: 'update-ref', category: 'destructive', riskLevel: 'high', description: 'Update reference', requiresConfirmation: true },
  { name: 'gc', category: 'destructive', riskLevel: 'medium', description: 'Garbage collection', requiresConfirmation: true },
  { name: 'prune', category: 'destructive', riskLevel: 'medium', description: 'Prune unreachable objects', requiresConfirmation: true },
  { name: 'notes', category: 'write', riskLevel: 'low', description: 'Add/inspect notes', requiresConfirmation: false },

  { name: 'init', category: 'admin', riskLevel: 'medium', description: 'Initialize repository', requiresConfirmation: true },
  { name: 'fsck', category: 'admin', riskLevel: 'low', description: 'Filesystem checks', requiresConfirmation: false },
  { name: 'repack', category: 'admin', riskLevel: 'medium', description: 'Pack objects', requiresConfirmation: true },
  { name: 'archive', category: 'read', riskLevel: 'low', description: 'Create archive', requiresConfirmation: false },
  { name: 'bundle', category: 'network', riskLevel: 'medium', description: 'Bundle objects', requiresConfirmation: false },
  { name: 'worktree', category: 'write', riskLevel: 'medium', description: 'Manage worktrees', requiresConfirmation: true },
  { name: 'sparse-checkout', category: 'write', riskLevel: 'medium', description: 'Initialize sparse checkout', requiresConfirmation: false },
  { name: 'maintenance', category: 'admin', riskLevel: 'low', description: 'Repository maintenance', requiresConfirmation: false },
];

const GIT_FORCE_FLAGS = new Set(['--force', '-f']);
const GIT_HARD_FLAG = '--hard';

export function parseGitCommand(command: string): ParsedGitCommand {
  const trimmed = command.trim();
  const tokens = tokenize(trimmed);
  const gitIdx = tokens.findIndex((t) => t === 'git');
  if (gitIdx === -1) {
    return { fullCommand: trimmed, subcommand: '', args: [], flags: [], hasForceFlag: false, hasHardFlag: false };
  }

  const remaining = tokens.slice(gitIdx + 1);
  const args: string[] = [];
  const flags: string[] = [];
  let subcommand = '';
  let hasForceFlag = false;
  let hasHardFlag = false;
  let targetBranch: string | undefined;
  let remoteUrl: string | undefined;

  let foundSubcommand = false;
  for (let i = 0; i < remaining.length; i++) {
    const token = remaining[i];

    if (token.startsWith('-')) {
      flags.push(token);
      if (GIT_FORCE_FLAGS.has(token)) {
        hasForceFlag = true;
      }
      if (token === GIT_HARD_FLAG) {
        hasHardFlag = true;
      }
      continue;
    }

    if (!foundSubcommand && !token.startsWith('-')) {
      subcommand = token;
      foundSubcommand = true;
      continue;
    }

    if (subcommand === 'push' && i === remaining.length - 1 && !token.startsWith('-')) {
      remoteUrl = token;
    } else if ((subcommand === 'push' || subcommand === 'checkout') && !token.startsWith('-')) {
      targetBranch = token;
    }

    args.push(token);
  }

  return {
    fullCommand: trimmed,
    subcommand,
    args,
    flags,
    hasForceFlag,
    hasHardFlag,
    targetBranch,
    remoteUrl,
  };
}

export function classifyGitSubcommand(subcommand: string): GitSubcommandInfo | undefined {
  return GIT_SUBCOMMANDS.find((s) => s.name === subcommand);
}

export function isGitCommand(command: string): boolean {
  return /^git\s/.test(command.trim().toLowerCase());
}

export function validateGitCommand(
  command: string,
  options: Partial<GitSafetyOptions> = {},
): GitValidationResult {
  const opts = { ...DEFAULT_GIT_OPTIONS, ...options };
  const issues: GitSafetyIssue[] = [];

  if (!isGitCommand(command)) {
    return {
      safe: true,
      riskLevel: 'low',
      behavior: 'allow',
      issues: [],
      parsedCommand: parseGitCommand(command),
    };
  }

  const parsed = parseGitCommand(command);
  const subcommandInfo = classifyGitSubcommand(parsed.subcommand);

  if (opts.denySubcommands.includes(parsed.subcommand)) {
    issues.push({
      type: 'unknown-subcommand',
      severity: 'high',
      message: `Git subcommand '${parsed.subcommand}' is explicitly denied`,
    });
  }

  if (opts.askSubcommands.includes(parsed.subcommand)) {
    if (!subcommandInfo) {
      return {
        safe: true,
        riskLevel: 'medium',
        behavior: 'ask',
        issues: [{
          type: 'unknown-subcommand',
          severity: 'medium',
          message: `Unknown git subcommand '${parsed.subcommand}' needs confirmation`,
        }],
        subcommandInfo: undefined,
        parsedCommand: parsed,
      };
    }
  }

  if (!subcommandInfo) {
    return {
      safe: true,
      riskLevel: 'medium',
      behavior: 'ask',
      issues: [{
        type: 'unknown-subcommand',
        severity: 'medium',
        message: `Unknown git subcommand '${parsed.subcommand}' needs confirmation`,
      }],
      subcommandInfo: undefined,
      parsedCommand: parsed,
    };
  }

  if (subcommandInfo.category === 'destructive' || subcommandInfo.category === 'admin') {
    if (parsed.subcommand === 'push' && parsed.hasForceFlag) {
      if (!opts.allowForcePush) {
        issues.push({
          type: 'force-push',
          severity: 'critical',
          message: 'Force push is not allowed by current policy',
        });
      }

      const branch = parsed.targetBranch || parsed.args[parsed.args.length - 1];
      if (branch && isProtectedBranch(branch, opts.protectedBranches)) {
        issues.push({
          type: 'protected-branch',
          severity: 'critical',
          message: `Branch '${branch}' is protected from force push`,
        });
      }
    }

    if (parsed.subcommand === 'reset' && parsed.hasHardFlag) {
      if (!opts.allowHardReset) {
        issues.push({
          type: 'hard-reset',
          severity: 'critical',
          message: 'Hard reset is not allowed by current policy',
        });
      }

      const branch = parsed.args[0];
      if (branch && isProtectedBranch(branch, opts.protectedBranches)) {
        issues.push({
          type: 'protected-branch',
          severity: 'critical',
          message: `Branch '${branch}' is protected from hard reset`,
        });
      }
    }

    if (parsed.subcommand === 'clean' && (parsed.hasForceFlag || parsed.flags.some((f) => f === '-d' || f === '-x'))) {
      if (!opts.allowDestructiveClean) {
        issues.push({
          type: 'history-rewrite',
          severity: 'high',
          message: 'Destructive clean is not allowed by current policy',
        });
      }
    }

    if (['filter-branch', 'rebase'].includes(parsed.subcommand) && parsed.flags.some((f) => f.startsWith('--onto') || f === '-i')) {
      if (!opts.allowRewriteHistory) {
        issues.push({
          type: 'history-rewrite',
          severity: 'critical',
          message: `History rewrite via '${parsed.subcommand}' is not allowed`,
        });
      }
    }

    if (subcommandInfo.category === 'admin' && !opts.allowAdminOperations) {
      issues.push({
        type: 'admin-operation',
        severity: 'high',
        message: `Admin operation '${parsed.subcommand}' is not allowed`,
      });
    }
  }

  if (subcommandInfo.category === 'network') {
    if (!opts.allowNetworkOperations) {
      issues.push({
        type: 'network-operation',
        severity: 'medium',
        message: 'Network operations are not allowed',
      });
    }

    if (parsed.subcommand === 'clone' || parsed.subcommand === 'push' || parsed.subcommand === 'pull' || parsed.subcommand === 'fetch') {
      const url = parsed.remoteUrl || parsed.args[0] || '';
      if (url) {
        const blockedHost = opts.blockedRemoteHosts.find((host) => url.includes(host));
        if (blockedHost) {
          issues.push({
            type: 'blocked-remote',
            severity: 'critical',
            message: `Remote host '${blockedHost}' is blocked`,
          });
        }
      }
    }
  }

  if (issues.length === 0) {
    return {
      safe: true,
      riskLevel: subcommandInfo.riskLevel,
      behavior: subcommandInfo.requiresConfirmation ? 'ask' : 'allow',
      issues: [],
      subcommandInfo,
      parsedCommand: parsed,
    };
  }

  const hasCritical = issues.some((i) => i.severity === 'critical');
  const hasHigh = issues.some((i) => i.severity === 'high');

  return {
    safe: !hasCritical,
    riskLevel: hasCritical ? 'high' : hasHigh ? 'medium' : 'low',
    behavior: hasCritical ? 'deny' : 'ask',
    issues,
    subcommandInfo,
    parsedCommand: parsed,
  };
}

export function getGitSubcommand(command: string): string | undefined {
  const parsed = parseGitCommand(command);
  return parsed.subcommand || undefined;
}

export function isGitSafeSubcommand(command: string): boolean {
  const parsed = parseGitCommand(command);
  const info = classifyGitSubcommand(parsed.subcommand);
  return info ? info.category === 'read' : false;
}

export function isProtectedBranch(branch: string, protectedBranches: string[]): boolean {
  for (const protectedBranch of protectedBranches) {
    if (protectedBranch.endsWith('/*')) {
      const prefix = protectedBranch.slice(0, -2);
      if (branch.startsWith(prefix)) {
        return true;
      }
    } else if (branch === protectedBranch) {
      return true;
    }
  }
  return false;
}

function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
      continue;
    }
    if (char === ' ') {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}
