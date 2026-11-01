/**
 * 注入攻击模式定义
 * 参考 cc_code/backend/tools/BashTool/bashSecurity.ts
 */

import type { SecurityPattern } from '../types';

export const INJECTION_PATTERNS: SecurityPattern[] = [
  {
    name: 'command_substitution',
    pattern: /\$\(/,
    message: '检测到命令替换 $()，可能执行任意代码',
    riskLevel: 'medium',
    behavior: 'ask',
  },
  {
    name: 'backtick_substitution',
    pattern: /`[^`]+`/,
    message: '检测到反引号命令替换，可能执行任意代码',
    riskLevel: 'medium',
    behavior: 'ask',
  },
  {
    name: 'process_substitution_in',
    pattern: /<\(/,
    message: '检测到进程替换 <()，可能执行任意代码',
    riskLevel: 'medium',
    behavior: 'ask',
  },
  {
    name: 'process_substitution_out',
    pattern: />\(/,
    message: '检测到进程替换 >()，可能执行任意代码',
    riskLevel: 'medium',
    behavior: 'ask',
  },
  {
    name: 'parameter_expansion',
    pattern: /\$\{[^}]+\}/,
    message: '检测到参数扩展 ${}，可能导致代码注入',
    riskLevel: 'low',
    behavior: 'ask',
  },
  {
    name: 'arithmetic_expansion',
    pattern: /\$\([^)]+\)/,
    message: '检测到算术扩展，需要确认',
    riskLevel: 'low',
    behavior: 'ask',
  },
  {
    name: 'curl_pipe_bash',
    pattern: /curl\s+.*\|\s*(bash|sh|zsh)/i,
    message: '检测到从网络下载并执行脚本，极度危险',
    riskLevel: 'high',
    behavior: 'deny',
  },
  {
    name: 'wget_pipe_bash',
    pattern: /wget\s+.*\|\s*(bash|sh|zsh)/i,
    message: '检测到从网络下载并执行脚本，极度危险',
    riskLevel: 'high',
    behavior: 'deny',
  },
  {
    name: 'base64_decode_exec',
    pattern: /base64\s+(-d|--decode).*\|\s*(bash|sh|zsh|eval)/i,
    message: '检测到 Base64 解码后执行，可能隐藏恶意代码',
    riskLevel: 'high',
    behavior: 'deny',
  },
  {
    name: 'eval_command',
    pattern: /\beval\s+/,
    message: '检测到 eval 命令，可能执行任意代码',
    riskLevel: 'high',
    behavior: 'ask',
  },
  {
    name: 'exec_command',
    pattern: /\bexec\s+/,
    message: '检测到 exec 命令，可能替换当前进程',
    riskLevel: 'medium',
    behavior: 'ask',
  },
  {
    name: 'source_command',
    pattern: /\b(source|\.)\s+/,
    message: '检测到 source 命令，可能执行脚本文件',
    riskLevel: 'low',
    behavior: 'ask',
  },
];

export const IFS_INJECTION_PATTERNS: SecurityPattern[] = [
  {
    name: 'ifs_injection',
    pattern: /\bIFS\s*=/,
    message: '检测到 IFS 变量修改，可能导致命令注入',
    riskLevel: 'medium',
    behavior: 'ask',
  },
];

export const ENV_INJECTION_PATTERNS: SecurityPattern[] = [
  {
    name: 'env_var_injection',
    pattern: /\b(PATH|LD_PRELOAD|LD_LIBRARY_PATH|PYTHONPATH)\s*=/,
    message: '检测到关键环境变量修改，可能导致权限提升',
    riskLevel: 'medium',
    behavior: 'ask',
  },
];
