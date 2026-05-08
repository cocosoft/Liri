/**
 * Bash命令语义分析
 * 分析命令类型用于UI折叠和安全决策
 * 参考CC_CODE: cc_code/backend/tools/BashTool/BashTool.tsx
 */

import { BashCommandType, BashCommandClassification } from './types';

export const BASH_SEARCH_COMMANDS = new Set([
  'find', 'grep', 'rg', 'ag', 'ack', 'locate', 'which', 'whereis',
  'sqlite3', 'mysql', 'psql', 'mongosh',
]);

export const BASH_READ_COMMANDS = new Set([
  'cat', 'head', 'tail', 'less', 'more',
  'wc', 'stat', 'file', 'strings',
  'jq', 'awk', 'cut', 'sort', 'uniq', 'tr',
  'xxd', 'hexdump', 'od', 'base64', 'md5sum', 'sha256sum',
]);

export const BASH_LIST_COMMANDS = new Set([
  'ls', 'tree', 'du', 'df', 'mount', 'jobs', 'ps', 'pgrep',
]);

export const BASH_SEMANTIC_NEUTRAL_COMMANDS = new Set([
  'echo', 'printf', 'true', 'false', ':',
]);

export const BASH_SILENT_COMMANDS = new Set([
  'mv', 'cp', 'rm', 'mkdir', 'rmdir', 'chmod', 'chown', 'chgrp',
  'touch', 'ln', 'cd', 'export', 'unset', 'wait', 'kill', 'sleep',
]);

export function splitCommandWithOperators(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  let escapeNext = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      if (inString && char === stringChar) {
        inString = false;
        current += char;
      } else if (!inString) {
        inString = true;
        stringChar = char;
        current += char;
      } else {
        current += char;
      }
      continue;
    }

    if (!inString) {
      if (char === ' ' || char === '\t') {
        if (current.trim()) {
          parts.push(current.trim());
        }
        current = '';
        continue;
      }

      if (char === '|' || char === '&' || char === ';' || char === '(' || char === ')' || char === '>') {
        if (current.trim()) {
          parts.push(current.trim());
        }
        current = '';
        const nextChar = command[i + 1];
        if ((char === '&' && nextChar === '&') ||
            (char === '|' && nextChar === '|')) {
          parts.push(char + nextChar);
          i++;
        } else if (char === '>' && nextChar === '&') {
          parts.push(char + nextChar);
          i++;
        } else if (char === '>' && nextChar === '>') {
          parts.push(char + nextChar);
          i++;
        } else {
          parts.push(char);
        }
        continue;
      }

      if (char === '>' || char === '<' || char === '>>') {
        if (current.trim()) {
          parts.push(current.trim());
        }
        current = '';
        const nextChar = command[i + 1];
        if (char === '>' && nextChar === '>') {
          parts.push('>>');
          i++;
        } else if (char === '>' && nextChar === '&') {
          parts.push('>&');
          i++;
        } else {
          parts.push(char);
        }
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function getBaseCommand(part: string): string {
  return part.trim().split(/\s+/)[0];
}

function normalizeCommandForLookup(cmd: string): string {
  let result = cmd;
  if ((result.startsWith('"') && result.endsWith('"')) ||
      (result.startsWith("'") && result.endsWith("'"))) {
    result = result.slice(1, -1);
  }
  return result;
}

function isLikelyArgument(token: string): boolean {
  if (token.startsWith('-')) return true;
  if (token.includes('/') || token.includes('\\')) return true;
  if (token.includes('.') && (token.includes('/') || token.includes('\\') || token.startsWith('.'))) return true;
  return false;
}

export function analyzeBashCommandType(command: string): BashCommandClassification {
  const normalizedCommand = command.trim();
  if (!normalizedCommand) {
    return {
      type: 'unknown',
      isSearch: false,
      isRead: false,
      isList: false,
      isSemanticNeutral: false,
      isSilent: false,
    };
  }

  let partsWithOperators: string[];
  try {
    partsWithOperators = splitCommandWithOperators(normalizedCommand);
  } catch {
    return {
      type: 'unknown',
      isSearch: false,
      isRead: false,
      isList: false,
      isSemanticNeutral: false,
      isSilent: false,
    };
  }

  if (partsWithOperators.length === 0) {
    return {
      type: 'unknown',
      isSearch: false,
      isRead: false,
      isList: false,
      isSemanticNeutral: false,
      isSilent: false,
    };
  }

  const commandParts = partsWithOperators.filter(p =>
    p !== '>' && p !== '>>' && p !== '<' && p !== '>&' &&
    p !== '||' && p !== '&&' && p !== '|' && p !== ';' &&
    p !== '(' && p !== ')'
  );

  if (commandParts.length === 0) {
    return {
      type: 'neutral',
      isSearch: false,
      isRead: false,
      isList: false,
      isSemanticNeutral: true,
      isSilent: false,
    };
  }

  const firstCommand = normalizeCommandForLookup(getBaseCommand(commandParts[0]));

  if (!firstCommand) {
    return {
      type: 'unknown',
      isSearch: false,
      isRead: false,
      isList: false,
      isSemanticNeutral: false,
      isSilent: false,
    };
  }

  if (BASH_SEMANTIC_NEUTRAL_COMMANDS.has(firstCommand)) {
    const otherCommands = commandParts.slice(1).map(p => normalizeCommandForLookup(getBaseCommand(p))).filter(p => p);
    if (otherCommands.length === 0) {
      return {
        type: 'neutral',
        isSearch: false,
        isRead: false,
        isList: false,
        isSemanticNeutral: true,
        isSilent: false,
      };
    }
    const actualCommands = otherCommands.filter(cmd =>
      BASH_SEARCH_COMMANDS.has(cmd) ||
      BASH_READ_COMMANDS.has(cmd) ||
      BASH_LIST_COMMANDS.has(cmd) ||
      BASH_SILENT_COMMANDS.has(cmd) ||
      BASH_SEMANTIC_NEUTRAL_COMMANDS.has(cmd)
    );
    if (actualCommands.length === 0) {
      return {
        type: 'neutral',
        isSearch: false,
        isRead: false,
        isList: false,
        isSemanticNeutral: true,
        isSilent: false,
      };
    }
    const hasNonNeutral = actualCommands.some(cmd =>
      !BASH_SEMANTIC_NEUTRAL_COMMANDS.has(cmd)
    );
    if (!hasNonNeutral) {
      return {
        type: 'neutral',
        isSearch: false,
        isRead: false,
        isList: false,
        isSemanticNeutral: true,
        isSilent: false,
      };
    }
  }

  let hasSearch = false;
  let hasRead = false;
  let hasList = false;

  for (const part of commandParts) {
    const baseCommand = normalizeCommandForLookup(getBaseCommand(part));
    if (!baseCommand) {
      continue;
    }
    if (BASH_SEMANTIC_NEUTRAL_COMMANDS.has(baseCommand)) {
      continue;
    }
    if (BASH_SEARCH_COMMANDS.has(baseCommand)) {
      hasSearch = true;
    }
    if (BASH_READ_COMMANDS.has(baseCommand)) {
      hasRead = true;
    }
    if (BASH_LIST_COMMANDS.has(baseCommand)) {
      hasList = true;
    }
  }

  if (!hasSearch && !hasRead && !hasList) {
    return {
      type: 'other',
      isSearch: false,
      isRead: false,
      isList: false,
      isSemanticNeutral: false,
      isSilent: false,
    };
  }

  let type: BashCommandType = 'other';
  if (hasSearch) type = 'search';
  else if (hasList) type = 'list';
  else if (hasRead) type = 'read';

  return {
    type,
    isSearch: hasSearch,
    isRead: hasRead,
    isList: hasList,
    isSemanticNeutral: false,
    isSilent: false,
  };
}

export function isSilentBashCommand(command: string): boolean {
  const normalizedCommand = command.trim();
  if (!normalizedCommand) {
    return false;
  }

  let partsWithOperators: string[];
  try {
    partsWithOperators = splitCommandWithOperators(normalizedCommand);
  } catch {
    return false;
  }

  if (partsWithOperators.length === 0) {
    return false;
  }

  let hasNonSilentCommand = false;
  let lastOperator: string | null = null;

  for (const part of partsWithOperators) {
    if (part === '>' || part === '>>' || part === '>&') {
      continue;
    }
    if (part === '||' || part === '&&' || part === '|' || part === ';') {
      lastOperator = part;
      continue;
    }
    const baseCommand = normalizeCommandForLookup(part.trim().split(/\s+/)[0]);
    if (!baseCommand) {
      continue;
    }
    if (baseCommand.startsWith('-')) {
      continue;
    }
    if (lastOperator === '||' && BASH_SEMANTIC_NEUTRAL_COMMANDS.has(baseCommand)) {
      continue;
    }
    hasNonSilentCommand = true;
    if (!BASH_SILENT_COMMANDS.has(baseCommand)) {
      return false;
    }
  }

  return hasNonSilentCommand;
}
