/**
 * 危险命令模式定义
 * 参考 cc_code/backend/tools/BashTool/bashSecurity.ts
 */

import type { SecurityPattern } from '../types';

export const DANGEROUS_COMMAND_PATTERNS: SecurityPattern[] = [
  {
    name: 'rm_root',
    pattern: /\brm\s+(-[rf]+\s+)*\//i,
    message: '尝试删除根目录或系统目录',
    riskLevel: 'high',
    behavior: 'deny',
  },
  {
    name: 'rm_force_recursive',
    pattern: /\brm\s+(-[rf]+\s+)*\*(\s|$)/i,
    message: '尝试强制递归删除所有文件',
    riskLevel: 'high',
    behavior: 'deny',
  },
  {
    name: 'mkfs',
    pattern: /\bmkfs\./i,
    message: '尝试格式化文件系统',
    riskLevel: 'high',
    behavior: 'deny',
  },
  {
    name: 'dd_device',
    pattern: /\bdd\s+.*of=\/dev\//i,
    message: '尝试直接写入设备文件',
    riskLevel: 'high',
    behavior: 'deny',
  },
  {
    name: 'fork_bomb',
    pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;?\s*:/,
    message: '检测到 Fork 炸弹',
    riskLevel: 'high',
    behavior: 'deny',
  },
  {
    name: 'chmod_777',
    pattern: /\bchmod\s+(-R\s+)?777\s+\//i,
    message: '尝试设置危险的文件权限',
    riskLevel: 'high',
    behavior: 'ask',
  },
  {
    name: 'chown_recursive',
    pattern: /\bchown\s+.*-R.*\//i,
    message: '尝试递归修改文件所有者',
    riskLevel: 'medium',
    behavior: 'ask',
  },
  {
    name: 'shutdown',
    pattern: /\b(shutdown|poweroff|reboot|halt)\b/i,
    message: '尝试执行系统关机/重启命令',
    riskLevel: 'high',
    behavior: 'ask',
  },
  {
    name: 'iptables',
    pattern: /\biptables\b/i,
    message: '尝试修改防火墙规则',
    riskLevel: 'high',
    behavior: 'ask',
  },
  {
    name: 'userdel',
    pattern: /\buserdel\b/i,
    message: '尝试删除用户',
    riskLevel: 'high',
    behavior: 'ask',
  },
];

export const DANGEROUS_BASE_COMMANDS = new Set([
  'mkfs',
  'fdisk',
  'parted',
  'dd',
  'shred',
  'wipefs',
  'badblocks',
]);
