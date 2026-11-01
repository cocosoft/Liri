/**
 * Shell 特定检查模式
 * 参考 cc_code/backend/tools/BashTool/bashSecurity.ts
 */

import type { SecurityPattern } from '../types';

export const ZSH_SPECIFIC_PATTERNS: SecurityPattern[] = [
  {
    name: 'zsh_equals_expansion',
    pattern: /(?:^|[\s;&|])=[a-zA-Z_]/,
    message: '检测到 Zsh equals expansion (=cmd)，可能绕过命令检查',
    riskLevel: 'medium',
    behavior: 'ask',
  },
  {
    name: 'zsh_glob_qualifier',
    pattern: /\(e:/,
    message: '检测到 Zsh glob qualifier，可能执行任意代码',
    riskLevel: 'high',
    behavior: 'ask',
  },
  {
    name: 'zsh_param_expansion',
    pattern: /~\[/,
    message: '检测到 Zsh 参数扩展，可能导致代码执行',
    riskLevel: 'medium',
    behavior: 'ask',
  },
];

export const ZSH_DANGEROUS_COMMANDS = new Set([
  'zmodload',
  'emulate',
  'sysopen',
  'sysread',
  'syswrite',
  'sysseek',
  'zpty',
  'ztcp',
  'zsocket',
  'mapfile',
]);

export const PRIVILEGE_ESCALATION_COMMANDS: SecurityPattern[] = [
  {
    name: 'sudo_command',
    pattern: /\bsudo\b/i,
    message: '检测到 sudo 命令，尝试权限提升',
    riskLevel: 'high',
    behavior: 'ask',
  },
  {
    name: 'doas_command',
    pattern: /\bdoas\b/i,
    message: '检测到 doas 命令，尝试权限提升',
    riskLevel: 'high',
    behavior: 'ask',
  },
  {
    name: 'pkexec_command',
    pattern: /\bpkexec\b/i,
    message: '检测到 pkexec 命令，尝试权限提升',
    riskLevel: 'high',
    behavior: 'ask',
  },
  {
    name: 'su_command',
    pattern: /\bsu\b/i,
    message: '检测到 su 命令，尝试切换用户',
    riskLevel: 'high',
    behavior: 'ask',
  },
];

export const SPECIAL_CHAR_PATTERNS: SecurityPattern[] = [
  {
    name: 'unicode_zero_width',
    pattern: /[\u200B-\u200F\u2028-\u202F\u205F-\u206F]/,
    message: '检测到 Unicode 零宽字符，可能隐藏恶意代码',
    riskLevel: 'high',
    behavior: 'deny',
  },
  {
    name: 'control_characters',
    pattern: /[\x00-\x08\x0B\x0C\x0E-\x1F]/,
    message: '检测到控制字符，可能导致注入攻击',
    riskLevel: 'high',
    behavior: 'deny',
  },
  {
    name: 'null_byte',
    pattern: /\x00/,
    message: '检测到空字节，可能导致注入攻击',
    riskLevel: 'high',
    behavior: 'deny',
  },
];
