import type { SecurityAnalysisResult, RiskLevel } from './types'

export interface DestructiveCommandConfig {
  commands: string[]
  flags: string[]
  baseCommands: string[]
  messageTemplate: string
  riskLevel: RiskLevel
}

const DESTRUCTIVE_COMMANDS: DestructiveCommandConfig[] = [
  {
    commands: ['rm'],
    flags: ['-rf', '-r', '-f', '--recursive', '--force'],
    baseCommands: ['rm'],
    messageTemplate: 'Destructive deletion detected: {command}. This will permanently delete files.',
    riskLevel: 'high',
  },
  {
    commands: ['git reset'],
    flags: ['--hard'],
    baseCommands: ['git'],
    messageTemplate: 'Destructive git operation: {command}. This will irreversibly modify repository state.',
    riskLevel: 'high',
  },
  {
    commands: ['git clean'],
    flags: ['-f', '-d', '-x', '--force'],
    baseCommands: ['git'],
    messageTemplate: 'Git clean with force: {command}. This will delete untracked files.',
    riskLevel: 'medium',
  },
  {
    commands: ['git push'],
    flags: ['--force', '-f', '--force-with-lease'],
    baseCommands: ['git'],
    messageTemplate: 'Force push detected: {command}. This may overwrite remote history.',
    riskLevel: 'high',
  },
  {
    commands: ['npm publish', 'yarn publish'],
    flags: [],
    baseCommands: ['npm', 'yarn'],
    messageTemplate: 'Package publish detected: {command}. This will publish to the registry.',
    riskLevel: 'medium',
  },
  {
    commands: ['docker rm', 'docker rmi', 'docker system prune'],
    flags: ['-f', '--force'],
    baseCommands: ['docker'],
    messageTemplate: 'Docker resource deletion: {command}. This will remove containers/images.',
    riskLevel: 'medium',
  },
  {
    commands: ['dropdb', 'DROP DATABASE', 'DROP TABLE', 'TRUNCATE'],
    flags: [],
    baseCommands: ['dropdb', 'psql', 'mysql'],
    messageTemplate: 'Database destructive operation: {command}. This may result in data loss.',
    riskLevel: 'high',
  },
  {
    commands: ['format', 'mkfs'],
    flags: [],
    baseCommands: ['mkfs', 'format'],
    messageTemplate: 'Disk format operation: {command}. This will destroy all data on the target.',
    riskLevel: 'high',
  },
  {
    commands: ['shutdown', 'reboot', 'halt', 'poweroff'],
    flags: [],
    baseCommands: ['shutdown', 'reboot', 'halt', 'poweroff', 'systemctl'],
    messageTemplate: 'System control command: {command}. This will affect system state.',
    riskLevel: 'high',
  },
  {
    commands: ['userdel', 'usermod -L', 'passwd -l'],
    flags: [],
    baseCommands: ['userdel', 'usermod', 'passwd'],
    messageTemplate: 'User account modification: {command}. This may lock or remove accounts.',
    riskLevel: 'high',
  },
  {
    commands: ['chmod 777'],
    flags: [],
    baseCommands: ['chmod'],
    messageTemplate: 'Insecure permissions: {command}. This opens files to all users.',
    riskLevel: 'medium',
  },
  {
    commands: ['rmdir /s', 'rmdir /q'],
    flags: ['/s', '/q'],
    baseCommands: ['rmdir', 'del'],
    messageTemplate: 'Destructive Windows deletion: {command}.',
    riskLevel: 'high',
  },
]

export class DestructiveCommandWarner {
  analyze(command: string): { warning: string | null; riskLevel: RiskLevel; matchedCommand: string | null } {
    if (!command) return { warning: null, riskLevel: 'low', matchedCommand: null }

    const normalized = command.trim().toLowerCase()
    let bestMatch: { warning: string; riskLevel: RiskLevel; matchedCommand: string } | null = null
    let longestMatchLen = 0

    for (const config of DESTRUCTIVE_COMMANDS) {
      if (!config.baseCommands.some(base => {
        const baseLower = base.toLowerCase()
        return normalized === baseLower || normalized.startsWith(baseLower + ' ')
      })) {
        continue
      }

      let matched = false
      let maxCmdLen = 0

      for (const cmd of config.commands) {
        const cmdLower = cmd.toLowerCase()
        if (normalized.includes(cmdLower) && cmdLower.length > maxCmdLen) {
          maxCmdLen = cmdLower.length
        }
      }

      if (maxCmdLen > 0) {
        const hasDestructiveFlag = config.flags.length === 0 ||
          config.flags.some(flag => normalized.includes(flag.toLowerCase()))

        if (hasDestructiveFlag) {
          matched = true
        }
      }

      if (matched && maxCmdLen > longestMatchLen) {
        longestMatchLen = maxCmdLen
        bestMatch = {
          warning: config.messageTemplate.replace('{command}', command),
          riskLevel: config.riskLevel,
          matchedCommand: command,
        }
      }
    }

    if (bestMatch) {
      return {
        warning: bestMatch.warning,
        riskLevel: bestMatch.riskLevel,
        matchedCommand: bestMatch.matchedCommand,
      }
    }

    return { warning: null, riskLevel: 'low', matchedCommand: null }
  }

  formatWarning(command: string, riskLevel: RiskLevel, additionalInfo?: string): string {
    const prefix = riskLevel === 'high'
      ? '🚫 CRITICAL WARNING'
      : riskLevel === 'medium'
      ? '⚠ WARNING'
      : 'ℹ NOTICE'

    let message = `${prefix}: ${command}`
    if (additionalInfo) {
      message += `\n  ${additionalInfo}`
    }
    message += '\n  Are you sure you want to proceed?'
    return message
  }
}
