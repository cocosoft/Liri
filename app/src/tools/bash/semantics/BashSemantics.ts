/**
 * Bash命令语义分析
 * 分析命令类型用于UI折叠和安全决策
 * 参考CC_CODE BashTool.tsx isSearchOrReadBashCommand实现
 */

import { BashCommandType, BashCommandClassification } from './types';

export const BASH_SEARCH_COMMANDS = new Set([
  'find',
  'grep',
  'rg',
  'ag',
  'ack',
  'locate',
  'which',
  'whereis',
  'sqlite3',
  'mysql',
  'psql',
  'mongosh',
]);

export const BASH_READ_COMMANDS = new Set([
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'wc',
  'stat',
  'file',
  'strings',
  'xxd',
  'hexdump',
  'od',
  'base64',
  'md5sum',
  'sha256sum',
  'jq',
  'awk',
  'cut',
  'sort',
  'uniq',
  'tr',
]);

export const BASH_LIST_COMMANDS = new Set([
  'ls',
  'tree',
  'du',
  'df',
  'mount',
  'jobs',
  'ps',
  'pgrep',
]);

export const BASH_SEMANTIC_NEUTRAL_COMMANDS = new Set([
  'echo',
  'printf',
  'true',
  'false',
  ':',
]);

export const BASH_SILENT_COMMANDS = new Set([
  'mv',
  'cp',
  'rm',
  'mkdir',
  'rmdir',
  'chmod',
  'chown',
  'chgrp',
  'touch',
  'ln',
  'cd',
  'export',
  'unset',
  'wait',
]);

function classifyCommand(firstPart: string): BashCommandType {
  if (BASH_SEARCH_COMMANDS.has(firstPart)) return 'search';
  if (BASH_READ_COMMANDS.has(firstPart)) return 'read';
  if (BASH_LIST_COMMANDS.has(firstPart)) return 'list';
  if (BASH_SILENT_COMMANDS.has(firstPart)) return 'silent';
  if (BASH_SEMANTIC_NEUTRAL_COMMANDS.has(firstPart)) return 'neutral';
  return 'other';
}

export function analyzeBashCommandType(
  command: string
): BashCommandClassification {
  const normalizedCommand = command.trim().toLowerCase();
  const parts = normalizedCommand.split(/\s+/);
  const firstPart = parts[0];

  if (!firstPart) {
    return {
      type: 'unknown',
      isSearch: false,
      isRead: false,
      isList: false,
      isSemanticNeutral: false,
      isSilent: false,
    };
  }

  return {
    type: classifyCommand(firstPart),
    isSearch: BASH_SEARCH_COMMANDS.has(firstPart),
    isRead: BASH_READ_COMMANDS.has(firstPart),
    isList: BASH_LIST_COMMANDS.has(firstPart),
    isSemanticNeutral: BASH_SEMANTIC_NEUTRAL_COMMANDS.has(firstPart),
    isSilent: BASH_SILENT_COMMANDS.has(firstPart),
  };
}

export function isSearchOrReadBashCommand(command: string): {
  isSearch: boolean;
  isRead: boolean;
  isList: boolean;
} {
  const parts = command.trim().split(/\s+/);
  const firstPart = parts[0]?.toLowerCase() || '';

  if (!firstPart) {
    return { isSearch: false, isRead: false, isList: false };
  }

  return {
    isSearch: BASH_SEARCH_COMMANDS.has(firstPart),
    isRead: BASH_READ_COMMANDS.has(firstPart),
    isList: BASH_LIST_COMMANDS.has(firstPart),
  };
}

export function isBashCommandSilent(command: string): boolean {
  const parts = command.trim().split(/\s+/);
  const firstPart = parts[0]?.toLowerCase() || '';
  return BASH_SILENT_COMMANDS.has(firstPart);
}

export function isBashCommandSemanticNeutral(command: string): boolean {
  const parts = command.trim().split(/\s+/);
  const firstPart = parts[0]?.toLowerCase() || '';
  return BASH_SEMANTIC_NEUTRAL_COMMANDS.has(firstPart);
}

export function generateCommandSummary(
  classification: BashCommandClassification,
  outputLines?: number
): string {
  if (classification.isSearch) return `Searched with command`;
  if (classification.isList) return `Listed ${outputLines ?? 0} directories`;
  if (classification.isRead) return `Read ${outputLines ?? 0} files`;
  if (classification.isSilent) return `Executed silently`;
  return `Executed command`;
}
