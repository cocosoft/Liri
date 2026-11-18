/**
 * 危险命令检测
 * 检测命令中是否包含危险或被排除的命令
 */
import { BashPermissionRule } from '../SandboxTypes';
/**
 * 常见的危险命令模式
 */
const DANGEROUS_PATTERNS: string[] = [
  // P0 紧急新增：Remove-Item 别名全覆盖
  'remove-item',
  'ri ',
  'rd ',
  'rmdir ',
  // 原始模式列表
  'rm -rf',
  'rm -rf /',
  'rm -rf *',
  'dd',
  ':(){:|:&};:',
  'mkfs',
  'fdisk',
  'parted',
  'shutdown',
  'reboot',
  'init 6',
  'kill -9',
  'killall',
  'chmod -R',
  'chmod 777',
  'chown -R',
  'chgrp -R',
  'userdel',
  'useradd',
  'groupdel',
  'groupadd',
  'passwd',
  'su',
  'sudo',
  'doas',
  'pkexec',
  'iptables',
  'ip6tables',
  'mount',
  'umount',
  'swapoff',
  'swapon',
  'poweroff',
  'halt',
  'wget',
  'curl',
  'eval',
  'exec',
  'source',
];

/**
 * 分割复合命令
 * @param command 命令字符串
 * @returns 子命令数组
 */
export function splitCompoundCommand(command: string): string[] {
  if (!command) {
    return [];
  }

  const subcommands: string[] = [];
  let current = '';
  let inQuote: "'" | '"' | null = null;
  let parenDepth = 0;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      }
      current += char;
    } else if (char === "'" || char === '"') {
      inQuote = char;
      current += char;
    } else if (char === '(' || char === '{') {
      parenDepth++;
      current += char;
    } else if (char === ')' || char === '}') {
      parenDepth--;
      current += char;
    } else if (char === ';' && parenDepth === 0) {
      if (current.trim()) {
        subcommands.push(current.trim());
      }
      current = '';
    } else if (char === '&' && command[i + 1] === '&' && parenDepth === 0) {
      if (current.trim()) {
        subcommands.push(current.trim());
      }
      current = '';
      i++;
    } else if (char === '|' && command[i + 1] === '|' && parenDepth === 0) {
      if (current.trim()) {
        subcommands.push(current.trim());
      }
      current = '';
      i++;
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    subcommands.push(current.trim());
  }

  return subcommands;
}

/**
 * 解析权限规则字符串
 * @param pattern 规则字符串
 * @returns 解析后的规则
 */
export function bashPermissionRule(pattern: string): BashPermissionRule {
  if (!pattern) {
    return { type: 'exact', command: '' };
  }

  if (pattern.endsWith('*')) {
    return { type: 'wildcard', pattern: pattern.slice(0, -1) };
  }
  if (pattern.includes('*')) {
    return { type: 'wildcard', pattern: pattern };
  }
  if (pattern.includes(':')) {
    const [prefix] = pattern.split(':');
    return { type: 'prefix', prefix: prefix.trim() };
  }
  return { type: 'exact', command: pattern };
}

/**
 * 匹配通配符模式
 * @param pattern 模式（不含*）
 * @param command 命令
 * @returns 是否匹配
 */
export function matchWildcardPattern(
  pattern: string,
  command: string
): boolean {
  if (!command || !pattern) {
    return false;
  }

  const trimmed = command.trim();
  const trimmedPattern = pattern.trim();
  return trimmed.startsWith(trimmedPattern) || trimmed === trimmedPattern;
}

/**
 * 剥离环境变量前缀
 * @param command 命令
 * @returns 剥离后的命令
 */
export function stripEnvVars(command: string): string {
  if (!command) {
    return '';
  }

  return command.replace(/^[A-Z_][A-Z0-9_]*=/, '').trim();
}

/**
 * 剥离安全的包装命令
 * @param command 命令
 * @returns 剥离后的命令
 */
export function stripSafeWrappers(command: string): string {
  if (!command) {
    return '';
  }

  const wrappers = ['timeout', 'time', 'nice', 'nohup', 'exec', 'sudo', 'env'];

  const parts = command.trim().split(/\s+/);
  const result: string[] = [];
  let foundWrapper = false;

  for (const part of parts) {
    if (!foundWrapper && wrappers.includes(part)) {
      foundWrapper = true;
      continue;
    }
    result.push(part);
  }

  return result.join(' ');
}

/**
 * 检查命令是否包含危险模式
 * @param command 命令
 * @returns 是否包含危险模式
 */
export function containsDangerousPattern(command: string): boolean {
  if (!command) {
    return false;
  }

  const lowerCommand = command.toLowerCase();
  for (const pattern of DANGEROUS_PATTERNS) {
    if (lowerCommand.includes(pattern.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * 检查命令是否匹配排除规则
 * @param command 命令
 * @param excludedPatterns 排除模式数组
 * @returns 是否匹配
 */
export function matchesExcludedPattern(
  command: string,
  excludedPatterns: string[]
): { matches: boolean; pattern: string } {
  if (!command) {
    return { matches: false, pattern: '' };
  }

  for (const pattern of excludedPatterns) {
    const rule = bashPermissionRule(pattern);
    const candidates = generateCommandCandidates(command);

    for (const candidate of candidates) {
      switch (rule.type) {
        case 'prefix':
          if (
            rule.prefix &&
            (candidate === rule.prefix ||
              candidate.startsWith(rule.prefix + ' '))
          ) {
            return { matches: true, pattern };
          }
          break;
        case 'exact':
          if (rule.command && candidate === rule.command) {
            return { matches: true, pattern };
          }
          break;
        case 'wildcard':
          if (rule.pattern && matchWildcardPattern(rule.pattern, candidate)) {
            return { matches: true, pattern };
          }
          break;
      }
    }
  }

  return { matches: false, pattern: '' };
}

/**
 * 生成命令候选列表
 * 包含原始命令和各种剥离后的版本
 * @param command 命令
 * @returns 候选命令列表
 */
export function generateCommandCandidates(command: string): string[] {
  if (!command) {
    return [];
  }

  const candidates: string[] = [command.trim()];
  const seen = new Set(candidates);

  let i = 0;
  while (i < candidates.length) {
    const current = candidates[i];
    i++;

    const envStripped = stripEnvVars(current);
    if (!seen.has(envStripped)) {
      candidates.push(envStripped);
      seen.add(envStripped);
    }

    const wrapperStripped = stripSafeWrappers(current);
    if (!seen.has(wrapperStripped)) {
      candidates.push(wrapperStripped);
      seen.add(wrapperStripped);
    }
  }

  return candidates;
}

/**
 * 检查命令是否包含排除命令
 * @param command 命令
 * @param excludedPatterns 排除模式数组
 * @returns 是否包含排除命令
 */
export function containsExcludedCommand(
  command: string,
  excludedPatterns: string[]
): boolean {
  if (!command || excludedPatterns.length === 0) {
    return false;
  }

  const subcommands = splitCompoundCommand(command);

  for (const subcommand of subcommands) {
    const { matches } = matchesExcludedPattern(subcommand, excludedPatterns);
    if (matches) {
      return true;
    }
  }

  return false;
}

/**
 * 执行危险命令检查
 * @param command 命令
 * @param excludedPatterns 排除模式数组
 * @returns 检查结果
 */
export function checkDangerousCommand(
  command: string,
  excludedPatterns: string[] = []
): {
  isDangerous: boolean;
  reason?: string;
  matchedPattern?: string;
} {
  if (!command) {
    return { isDangerous: false };
  }

  if (containsDangerousPattern(command)) {
    return {
      isDangerous: true,
      reason: '命令包含危险模式',
    };
  }

  if (containsExcludedCommand(command, excludedPatterns)) {
    const { pattern } = matchesExcludedPattern(command, excludedPatterns);
    return {
      isDangerous: true,
      reason: `命令匹配排除模式: ${pattern}`,
      matchedPattern: pattern,
    };
  }

  return { isDangerous: false };
}
