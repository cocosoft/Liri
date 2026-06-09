import { configManager } from '@modules/config';
import type { SecurityAnalysisResult, RiskLevel } from './types';

export interface ReadOnlyValidationOptions {
  enforceReadOnly: boolean;
  allowGitReadOnly: boolean;
  allowPackageManagerReadOnly: boolean;
  allowedCommands: string[];
  blockedCommands: string[];
}

export const DEFAULT_READONLY_CONFIG: ReadOnlyValidationOptions = {
  enforceReadOnly: configManager.env('READONLY_MODE') === 'true',
  allowGitReadOnly: true,
  allowPackageManagerReadOnly: false,
  allowedCommands: [
    'ls',
    'cat',
    'head',
    'tail',
    'less',
    'grep',
    'awk',
    'sed',
    'find',
    'wc',
    'sort',
    'uniq',
    'cut',
    'echo',
    'date',
    'env',
    'ps',
    'top',
    'free',
    'df',
    'du',
    'stat',
    'file',
    'which',
    'type',
    'test',
    '[',
    'true',
    'false',
    'printf',
    'dirname',
    'basename',
    'realpath',
    'readlink',
    'ln',
    'pwd',
  ],
  blockedCommands: [
    'rm',
    'rmdir',
    'unlink',
    'shred',
    'wipe',
    'chmod',
    'chown',
    'chgrp',
    'mkfs',
    'dd',
    'fdisk',
    'parted',
    'mkswap',
    'kill',
    'killall',
    'pkill',
    'shutdown',
    'reboot',
    'halt',
    'poweroff',
    'systemctl',
    'iptables',
    'firewall-cmd',
    'ufw',
    'nft',
    'useradd',
    'userdel',
    'usermod',
    'groupadd',
    'groupdel',
    'passwd',
    'crontab',
    'at',
    'batch',
  ],
};

const GIT_READ_ONLY_SUBCOMMANDS = new Set([
  'status',
  'log',
  'diff',
  'show',
  'branch',
  'tag',
  'ls-tree',
  'rev-list',
  'rev-parse',
  'remote',
  'config',
  'describe',
  'name-rev',
  'shortlog',
  'stash list',
  'blame',
  'grep',
  'bisect',
  'bisect log',
  'bisect visualize',
  'reflog',
  'notes',
  'archive',
  'bundle',
  'cat-file',
  'for-each-ref',
  'var',
]);

export class ReadOnlyValidator {
  private config: ReadOnlyValidationOptions;

  constructor(config?: Partial<ReadOnlyValidationOptions>) {
    this.config = { ...DEFAULT_READONLY_CONFIG, ...config };
  }

  get isEnforcing(): boolean {
    return this.config.enforceReadOnly;
  }

  setEnforceReadOnly(value: boolean): void {
    this.config.enforceReadOnly = value;
  }

  validate(command: string): SecurityAnalysisResult {
    if (!this.config.enforceReadOnly) {
      return {
        safe: true,
        behavior: 'allow',
        riskLevel: 'low',
        matchedPatterns: [],
      };
    }

    if (!command || !command.trim()) {
      return {
        safe: true,
        behavior: 'allow',
        riskLevel: 'low',
        matchedPatterns: [],
      };
    }

    const trimmed = command.trim();
    const tokens = this.simpleTokenize(trimmed);
    const baseCommand = tokens[0] || '';

    if (this.config.allowedCommands.includes(baseCommand)) {
      return {
        safe: true,
        behavior: 'allow',
        riskLevel: 'low',
        matchedPatterns: [],
      };
    }

    if (this.config.blockedCommands.includes(baseCommand)) {
      return {
        safe: false,
        behavior: 'deny',
        riskLevel: 'high',
        matchedPatterns: ['read_only_blocked'],
        message: `Command "${baseCommand}" is blocked in read-only mode`,
      };
    }

    if (this.config.allowGitReadOnly && baseCommand === 'git') {
      const subCmd = tokens.slice(1).join(' ');
      if (
        GIT_READ_ONLY_SUBCOMMANDS.has(subCmd) ||
        tokens.some((t) => GIT_READ_ONLY_SUBCOMMANDS.has(t))
      ) {
        return {
          safe: true,
          behavior: 'allow',
          riskLevel: 'low',
          matchedPatterns: ['git_read_only'],
        };
      }
      return {
        safe: false,
        behavior: 'deny',
        riskLevel: 'medium',
        matchedPatterns: ['read_only_git_write'],
        message: `Git write operation blocked in read-only mode: "${trimmed}"`,
      };
    }

    if (
      this.config.allowPackageManagerReadOnly &&
      ['npm', 'yarn', 'pnpm', 'pip'].includes(baseCommand)
    ) {
      const subCmd = tokens[1] || '';
      const readOnlyPm = [
        'info',
        'view',
        'list',
        'ls',
        'why',
        'explain',
        'outdated',
        'audit',
        'run',
        'exec',
      ];
      if (readOnlyPm.includes(subCmd)) {
        return {
          safe: true,
          behavior: 'allow',
          riskLevel: 'low',
          matchedPatterns: ['pm_read_only'],
        };
      }
    }

    return {
      safe: false,
      behavior: 'ask',
      riskLevel: 'medium',
      matchedPatterns: ['read_only_unknown'],
      message: `Unknown command in read-only mode: "${trimmed}"`,
    };
  }

  private simpleTokenize(command: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < command.length; i++) {
      const char = command[i];
      if (inQuote) {
        if (char === quoteChar) inQuote = false;
        else current += char;
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
    if (current) tokens.push(current);
    return tokens;
  }

  addAllowedCommand(command: string): void {
    if (!this.config.allowedCommands.includes(command)) {
      this.config.allowedCommands.push(command);
    }
  }

  removeAllowedCommand(command: string): void {
    this.config.allowedCommands = this.config.allowedCommands.filter(
      (c) => c !== command
    );
  }

  addBlockedCommand(command: string): void {
    if (!this.config.blockedCommands.includes(command)) {
      this.config.blockedCommands.push(command);
    }
  }

  removeBlockedCommand(command: string): void {
    this.config.blockedCommands = this.config.blockedCommands.filter(
      (c) => c !== command
    );
  }
}
