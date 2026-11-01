import type { SecurityPattern, RiskLevel, SecurityBehavior } from './types';

export interface CommandSemantic {
  baseCommand: string;
  subCommand?: string;
  args: string[];
  flags: string[];
  redirects: string[];
  pipes: string[];
  isDestructive: boolean;
  isReadOnly: boolean;
  affectsFilesystem: boolean;
  affectsNetwork: boolean;
  affectsProcesses: boolean;
  hasPrivilegeEscalation: boolean;
  isObfuscated: boolean;
}

export interface CommandSemanticPattern {
  baseCommands: string[];
  description: string;
  isReadOnly: boolean;
  isDestructive: boolean;
  affectsFilesystem: boolean;
  affectsNetwork: boolean;
  affectsProcesses: boolean;
}

const COMMAND_SEMANTICS_DB: CommandSemanticPattern[] = [
  {
    baseCommands: ['cat', 'head', 'tail', 'less', 'more'],
    description: 'File reading',
    isReadOnly: true,
    isDestructive: false,
    affectsFilesystem: false,
    affectsNetwork: false,
    affectsProcesses: false,
  },
  {
    baseCommands: ['ls', 'dir', 'find', 'locate', 'which', 'whereis'],
    description: 'File listing',
    isReadOnly: true,
    isDestructive: false,
    affectsFilesystem: false,
    affectsNetwork: false,
    affectsProcesses: false,
  },
  {
    baseCommands: ['grep', 'awk', 'sed', 'cut', 'sort', 'uniq', 'tr', 'wc'],
    description: 'Text processing',
    isReadOnly: true,
    isDestructive: false,
    affectsFilesystem: false,
    affectsNetwork: false,
    affectsProcesses: false,
  },
  {
    baseCommands: ['echo', 'printf', 'date', 'env', 'printenv'],
    description: 'Output utilities',
    isReadOnly: true,
    isDestructive: false,
    affectsFilesystem: false,
    affectsNetwork: false,
    affectsProcesses: false,
  },
  {
    baseCommands: ['ps', 'top', 'htop', 'free', 'df', 'du', 'uptime'],
    description: 'System monitoring',
    isReadOnly: true,
    isDestructive: false,
    affectsFilesystem: false,
    affectsNetwork: false,
    affectsProcesses: false,
  },
  {
    baseCommands: ['git', 'hg', 'svn'],
    description: 'Version control',
    isReadOnly: true,
    isDestructive: false,
    affectsFilesystem: true,
    affectsNetwork: true,
    affectsProcesses: false,
  },
  {
    baseCommands: ['curl', 'wget'],
    description: 'File download',
    isReadOnly: false,
    isDestructive: false,
    affectsFilesystem: true,
    affectsNetwork: true,
    affectsProcesses: false,
  },
  {
    baseCommands: ['npm', 'yarn', 'pnpm', 'bun', 'pip', 'cargo'],
    description: 'Package managers',
    isReadOnly: false,
    isDestructive: false,
    affectsFilesystem: true,
    affectsNetwork: true,
    affectsProcesses: false,
  },
  {
    baseCommands: ['rm', 'rmdir', 'unlink'],
    description: 'File deletion',
    isReadOnly: false,
    isDestructive: true,
    affectsFilesystem: true,
    affectsNetwork: false,
    affectsProcesses: false,
  },
  {
    baseCommands: ['mv', 'cp', 'install'],
    description: 'File manipulation',
    isReadOnly: false,
    isDestructive: false,
    affectsFilesystem: true,
    affectsNetwork: false,
    affectsProcesses: false,
  },
  {
    baseCommands: ['chmod', 'chown', 'chgrp'],
    description: 'Permission changes',
    isReadOnly: false,
    isDestructive: false,
    affectsFilesystem: true,
    affectsNetwork: false,
    affectsProcesses: false,
  },
  {
    baseCommands: ['mkfs', 'dd', 'fdisk', 'parted'],
    description: 'Disk operations',
    isReadOnly: false,
    isDestructive: true,
    affectsFilesystem: true,
    affectsNetwork: false,
    affectsProcesses: false,
  },
  {
    baseCommands: ['kill', 'killall', 'pkill', 'xkill'],
    description: 'Process termination',
    isReadOnly: false,
    isDestructive: true,
    affectsFilesystem: false,
    affectsNetwork: false,
    affectsProcesses: true,
  },
  {
    baseCommands: ['sudo', 'su', 'pkexec', 'doas'],
    description: 'Privilege escalation',
    isReadOnly: false,
    isDestructive: false,
    affectsFilesystem: true,
    affectsNetwork: true,
    affectsProcesses: true,
  },
  {
    baseCommands: ['shutdown', 'reboot', 'halt', 'poweroff', 'init'],
    description: 'System control',
    isReadOnly: false,
    isDestructive: true,
    affectsFilesystem: false,
    affectsNetwork: false,
    affectsProcesses: true,
  },
  {
    baseCommands: ['iptables', 'firewall-cmd', 'ufw', 'nft'],
    description: 'Firewall management',
    isReadOnly: false,
    isDestructive: false,
    affectsFilesystem: true,
    affectsNetwork: true,
    affectsProcesses: false,
  },
  {
    baseCommands: ['useradd', 'userdel', 'usermod', 'groupadd', 'groupdel'],
    description: 'User management',
    isReadOnly: false,
    isDestructive: true,
    affectsFilesystem: true,
    affectsNetwork: false,
    affectsProcesses: false,
  },
  {
    baseCommands: ['systemctl', 'service', 'launchctl'],
    description: 'Service management',
    isReadOnly: false,
    isDestructive: false,
    affectsFilesystem: true,
    affectsNetwork: true,
    affectsProcesses: true,
  },
  {
    baseCommands: ['docker', 'podman', 'kubectl'],
    description: 'Container orchestration',
    isReadOnly: false,
    isDestructive: false,
    affectsFilesystem: true,
    affectsNetwork: true,
    affectsProcesses: true,
  },
  {
    baseCommands: ['ssh', 'scp', 'sftp', 'rsync'],
    description: 'Remote access',
    isReadOnly: false,
    isDestructive: false,
    affectsFilesystem: true,
    affectsNetwork: true,
    affectsProcesses: false,
  },
];

export class CommandSemanticsAnalyzer {
  analyzeCommand(rawCommand: string): CommandSemantic {
    const trimmed = rawCommand.trim();
    const tokens = this.tokenize(trimmed);
    const baseCommand = tokens[0] || '';
    const semantic = this.lookupSemantic(baseCommand);

    const redirects: string[] = [];
    const pipes: string[] = [];
    const flags: string[] = [];
    let subCommand: string | undefined;

    let inRedirect = false;
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === '|') {
        pipes.push(tokens.slice(i + 1).join(' '));
        break;
      }
      if (
        token.startsWith('>') ||
        token.startsWith('<') ||
        token === '>>' ||
        token === '<<'
      ) {
        redirects.push(token + (tokens[i + 1] ? ' ' + tokens[i + 1] : ''));
        inRedirect = true;
        i++;
        continue;
      }
      if (token.startsWith('-')) {
        const flagParts = token.split('=');
        flags.push(flagParts[0]);
        continue;
      }
      if (!subCommand && !token.startsWith('-') && !inRedirect) {
        subCommand = token;
      }
    }

    const hasRedirectOutput = redirects.some((r) => r.startsWith('>'));
    const hasPrivilegeEscalation = [
      'sudo',
      'su',
      'pkexec',
      'doas',
      'run0',
    ].includes(baseCommand);

    return {
      baseCommand,
      subCommand,
      args: tokens.slice(1).filter((t) => !t.startsWith('-') && t !== '|'),
      flags,
      redirects,
      pipes,
      isDestructive: semantic?.isDestructive || false,
      isReadOnly: semantic?.isReadOnly || false,
      affectsFilesystem: semantic?.affectsFilesystem || hasRedirectOutput,
      affectsNetwork: semantic?.affectsNetwork || false,
      affectsProcesses: semantic?.affectsProcesses || false,
      hasPrivilegeEscalation,
      isObfuscated: this.detectObfuscation(rawCommand),
    };
  }

  private lookupSemantic(
    baseCommand: string
  ): CommandSemanticPattern | undefined {
    return COMMAND_SEMANTICS_DB.find((entry) =>
      entry.baseCommands.includes(baseCommand)
    );
  }

  private tokenize(command: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escaped = false;

    for (let i = 0; i < command.length; i++) {
      const char = command[i];

      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        current += char;
        continue;
      }

      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
        current += char;
        continue;
      }

      if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
        current += char;
        continue;
      }

      if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
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

  private detectObfuscation(command: string): boolean {
    const indicators = [
      /\$\{IFS\}/i,
      /\$\{\w+:\d+:\d+\}/,
      /\beval\b.*\$\{/i,
      /bash\s+<\s*\(/i,
      /base64\s+(-d|--decode)/i,
      /openssl\s+enc\b/i,
    ];

    for (const pattern of indicators) {
      if (pattern.test(command)) return true;
    }

    return false;
  }

  getReadOnlyGitCommands(): Record<string, string[]> {
    return {
      git: [
        'status',
        'log',
        'diff',
        'show',
        'branch',
        'tag',
        'ls-tree',
        'rev-list',
        'stash list',
        'remote -v',
      ],
    };
  }

  isReadOnlyGitCommand(command: string): boolean {
    const gitReadOnly = this.getReadOnlyGitCommands()['git'] || [];
    const parts = command.trim().split(/\s+/);
    if (parts[0] !== 'git') return false;

    const subCmd = parts.slice(1).join(' ');
    return gitReadOnly.some((cmd) => subCmd.startsWith(cmd));
  }
}
