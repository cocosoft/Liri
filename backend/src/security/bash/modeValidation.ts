/**
 * Mode Validation
 * 对标CC源码 utils/bash/modeValidation.ts
 * 基于当前执行模式验证命令是否允许执行
 */

import type {
  SecurityAnalysisResult,
  RiskLevel,
  SecurityBehavior,
} from '../types';

export type ExecutionMode =
  | 'normal'
  | 'restricted'
  | 'readOnly'
  | 'isolated'
  | 'observe';

export interface ModeValidationOptions {
  currentMode: ExecutionMode;
  allowModeSwitch: boolean;
  allowedModeTargets: ExecutionMode[];
  autoConfirmCommands: string[];
}

export interface ModeValidationResult {
  allowed: boolean;
  resolvedBehavior: SecurityBehavior;
  riskLevel: RiskLevel;
  currentMode: ExecutionMode;
  suggestedMode?: ExecutionMode;
  reasons: string[];
}

export const EXECUTION_MODES: Record<
  ExecutionMode,
  { label: string; description: string }
> = {
  normal: {
    label: 'Normal',
    description: 'Full execution allowed with standard security checks',
  },
  restricted: {
    label: 'Restricted',
    description: 'Only safe commands; write operations require confirmation',
  },
  readOnly: {
    label: 'Read Only',
    description: 'Only read operations allowed; all write/execute blocked',
  },
  isolated: {
    label: 'Isolated',
    description: 'Only extremely safe, non-side-effect commands allowed',
  },
  observe: {
    label: 'Observe',
    description: 'No execution allowed; only observation mode',
  },
};

const MODE_READ_WRITE_COMMANDS: Record<
  ExecutionMode,
  { allow: string[]; ask: string[]; deny: string[] }
> = {
  normal: {
    allow: ['*'],
    ask: [],
    deny: [],
  },
  restricted: {
    allow: [
      'ls',
      'cat',
      'head',
      'tail',
      'less',
      'more',
      'grep',
      'egrep',
      'fgrep',
      'awk',
      'sed',
      'find',
      'wc',
      'sort',
      'uniq',
      'cut',
      'tr',
      'echo',
      'printf',
      'date',
      'env',
      'printenv',
      'pwd',
      'which',
      'type',
      'dirname',
      'basename',
      'realpath',
      'readlink',
      'stat',
      'file',
      'du',
      'df',
      'ps',
      'top',
      'htop',
      'free',
      'uptime',
      'uname',
      'hostname',
      'whoami',
      'id',
      'groups',
      'diff',
      'comm',
      'cmp',
      'sha256sum',
      'sha1sum',
      'md5sum',
      'man',
      'help',
      'history',
      'git',
      'npm',
      'yarn',
      'pnpm',
      'pip',
      'python',
      'python3',
      'node',
      'deno',
      'bun',
      'mkdir',
      'touch',
      'cp',
      'mv',
      'chmod',
      'chown',
      'tar',
      'gzip',
      'gunzip',
      'zip',
      'unzip',
    ],
    ask: [
      'rm',
      'rmdir',
      'del',
      'erase',
      'rd',
      'ln',
      'mklink',
      'wget',
      'curl',
      'sudo',
      'doas',
      'pkexec',
      'kill',
      'killall',
      'pkill',
      'taskkill',
      'systemctl',
      'service',
      'sc',
      'reg',
      'regedit',
      'mount',
      'umount',
      'crontab',
      'at',
      'schtasks',
      'chmod',
      'chown',
      'chgrp',
      'icacls',
      'dd',
      'mkfs',
      'format',
      'shutdown',
      'reboot',
      'halt',
      'poweroff',
    ],
    deny: [
      'su',
      'runas',
      'useradd',
      'userdel',
      'usermod',
      'passwd',
      'groupadd',
      'groupdel',
      'iptables',
      'ufw',
      'firewall-cmd',
      'nft',
      'fdisk',
      'parted',
      'shred',
      'wipe',
    ],
  },
  readOnly: {
    allow: [
      'ls',
      'cat',
      'head',
      'tail',
      'less',
      'more',
      'grep',
      'egrep',
      'fgrep',
      'awk',
      'find',
      'wc',
      'sort',
      'uniq',
      'cut',
      'tr',
      'echo',
      'printf',
      'date',
      'env',
      'printenv',
      'pwd',
      'which',
      'type',
      'dirname',
      'basename',
      'realpath',
      'readlink',
      'stat',
      'file',
      'du',
      'df',
      'ps',
      'top',
      'htop',
      'free',
      'uptime',
      'uname',
      'hostname',
      'whoami',
      'id',
      'groups',
      'diff',
      'comm',
      'cmp',
      'sha256sum',
      'sha1sum',
      'md5sum',
      'man',
      'help',
      'history',
      'git status',
      'git log',
      'git diff',
      'git show',
      'git branch',
      'git tag',
      'git ls-tree',
      'git rev-parse',
      'git reflog',
      'git blame',
      'npm list',
      'npm view',
      'npm outdated',
    ],
    ask: ['git', 'npm', 'pip', 'python', 'python3', 'node'],
    deny: ['*'],
  },
  isolated: {
    allow: [
      'ls',
      'cat',
      'echo',
      'printf',
      'pwd',
      'which',
      'type',
      'dirname',
      'basename',
      'head',
      'tail',
      'wc',
      'sort',
      'date',
      'env',
      'true',
      'false',
      'man',
      'help',
    ],
    ask: [],
    deny: ['*'],
  },
  observe: {
    allow: [],
    ask: [],
    deny: ['*'],
  },
};

export class ModeValidator {
  private config: ModeValidationOptions;

  constructor(config?: Partial<ModeValidationOptions>) {
    this.config = {
      currentMode: 'normal',
      allowModeSwitch: true,
      allowedModeTargets: ['normal', 'restricted', 'readOnly'],
      autoConfirmCommands: [],
      ...config,
    };
  }

  get currentMode(): ExecutionMode {
    return this.config.currentMode;
  }

  setMode(mode: ExecutionMode): { success: boolean; reason?: string } {
    if (!this.config.allowModeSwitch) {
      return { success: false, reason: 'Mode switching is disabled' };
    }
    if (!this.config.allowedModeTargets.includes(mode)) {
      return {
        success: false,
        reason: `Mode '${mode}' is not in the allowed targets list`,
      };
    }
    this.config.currentMode = mode;
    return { success: true };
  }

  updateConfig(config: Partial<ModeValidationOptions>): void {
    this.config = { ...this.config, ...config };
  }

  validateCommand(
    command: string,
    context?: { baseCommand?: string }
  ): SecurityAnalysisResult {
    if (this.config.currentMode === 'normal') {
      return {
        safe: true,
        behavior: 'allow',
        riskLevel: 'low',
        matchedPatterns: [],
      };
    }

    const trimmed = command.trim().toLowerCase();
    if (!trimmed) {
      return {
        safe: true,
        behavior: 'allow',
        riskLevel: 'low',
        matchedPatterns: [],
      };
    }

    const baseCmd = context?.baseCommand || trimmed.split(/\s+/)[0] || '';
    const modeConfig = MODE_READ_WRITE_COMMANDS[this.config.currentMode];

    if (this.config.autoConfirmCommands.includes(baseCmd)) {
      return {
        safe: true,
        behavior: 'allow',
        riskLevel: 'low',
        matchedPatterns: ['mode_auto_confirm'],
      };
    }

    if (modeConfig.deny.includes('*')) {
      if (this.isInAllowList(trimmed, baseCmd, modeConfig.allow)) {
        return {
          safe: true,
          behavior: 'allow',
          riskLevel: 'low',
          matchedPatterns: ['mode_allowed'],
        };
      }
      if (this.isInAllowList(trimmed, baseCmd, modeConfig.ask)) {
        return {
          safe: true,
          behavior: 'ask',
          riskLevel: 'medium',
          matchedPatterns: ['mode_needs_confirm'],
          message: `Command '${trimmed}' needs confirmation in ${this.config.currentMode} mode`,
        };
      }
      return {
        safe: false,
        behavior: 'deny',
        riskLevel: 'high',
        matchedPatterns: ['mode_denied'],
        message: `Command '${baseCmd}' is not allowed in ${this.config.currentMode} mode`,
      };
    }

    if (modeConfig.deny.includes(baseCmd)) {
      return {
        safe: false,
        behavior: 'deny',
        riskLevel: 'high',
        matchedPatterns: ['mode_denied'],
        message: `Command '${baseCmd}' is denied in ${this.config.currentMode} mode`,
      };
    }

    if (modeConfig.allow.includes('*') || modeConfig.allow.includes(baseCmd)) {
      return {
        safe: true,
        behavior: 'allow',
        riskLevel: 'low',
        matchedPatterns: ['mode_allowed'],
      };
    }

    if (modeConfig.ask.includes(baseCmd)) {
      return {
        safe: true,
        behavior: 'ask',
        riskLevel: 'medium',
        matchedPatterns: ['mode_needs_confirm'],
        message: `Command '${baseCmd}' needs confirmation in ${this.config.currentMode} mode`,
      };
    }

    return {
      safe: false,
      behavior: 'ask',
      riskLevel: 'medium',
      matchedPatterns: ['mode_unknown'],
      message: `Unknown command '${baseCmd}' in ${this.config.currentMode} mode`,
    };
  }

  getSuitableMode(command: string): ModeValidationResult {
    const trimmed = command.trim().toLowerCase();
    const baseCmd = trimmed.split(/\s+/)[0] || '';

    for (const mode of [
      'observe',
      'isolated',
      'readOnly',
      'restricted',
      'normal',
    ] as ExecutionMode[]) {
      const modeConfig = MODE_READ_WRITE_COMMANDS[mode];
      if (
        modeConfig.allow.includes('*') ||
        modeConfig.allow.includes(baseCmd)
      ) {
        return {
          allowed: true,
          resolvedBehavior: 'allow',
          riskLevel: 'low',
          currentMode: this.config.currentMode,
          suggestedMode: mode,
          reasons: [`Command '${baseCmd}' is allowed in '${mode}' mode`],
        };
      }
    }

    return {
      allowed: false,
      resolvedBehavior: 'deny',
      riskLevel: 'high',
      currentMode: this.config.currentMode,
      reasons: [`Command '${baseCmd}' is not allowed in any execution mode`],
    };
  }

  isModeTransitionSafe(
    from: ExecutionMode,
    to: ExecutionMode
  ): { safe: boolean; reason?: string } {
    const escalationMap: Record<ExecutionMode, number> = {
      observe: 0,
      isolated: 1,
      readOnly: 2,
      restricted: 3,
      normal: 4,
    };

    const fromLevel = escalationMap[from];
    const toLevel = escalationMap[to];

    if (toLevel > fromLevel) {
      return {
        safe: true,
        reason: `Escalating from '${from}' to '${to}' (${fromLevel} → ${toLevel})`,
      };
    }
    if (toLevel < fromLevel) {
      return {
        safe: false,
        reason: `De-escalating from '${from}' to '${to}' requires explicit user approval`,
      };
    }
    return { safe: true, reason: `Same mode '${from}' → '${to}'` };
  }

  private isInAllowList(
    fullCommand: string,
    baseCmd: string,
    allowList: string[]
  ): boolean {
    if (allowList.includes('*')) {
      return true;
    }
    if (allowList.includes(baseCmd)) {
      return true;
    }
    for (const entry of allowList) {
      if (entry.includes(' ') && fullCommand.startsWith(entry)) {
        return true;
      }
    }
    return false;
  }
}

export function getModeConfig(
  mode: ExecutionMode
): { label: string; description: string } | undefined {
  return EXECUTION_MODES[mode];
}

export function getAllModes(): ExecutionMode[] {
  return ['normal', 'restricted', 'readOnly', 'isolated', 'observe'];
}

export function getModeLevel(mode: ExecutionMode): number {
  const levels: Record<ExecutionMode, number> = {
    observe: 0,
    isolated: 1,
    readOnly: 2,
    restricted: 3,
    normal: 4,
  };
  return levels[mode];
}
