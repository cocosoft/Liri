/**
 * 危险命令模式定义
 * P1：统一规则源——所有安全模块从此文件引用规则。
 * 规则分类：deletion / format / privilege / network / system / injection
 *
 * 参考 cc_code/backend/tools/BashTool/bashSecurity.ts
 */

import type { SecurityPattern } from '../types';

// ─── 扩展类型 ──────────────────────────────────────────────

/** P1: 统一规则平台类型 */
export type UnifiedRulePlatform = 'bash' | 'powershell' | 'cmd';

/** P1: 统一规则类别 */
export type UnifiedRuleCategory =
  | 'deletion'
  | 'format'
  | 'privilege'
  | 'network'
  | 'system'
  | 'injection';

/**
 * P1: 统一规则条目
 * 比 SecurityPattern 增加 platforms / category 字段，支持平台感知
 */
export interface UnifiedSecurityRule {
  /** 规则唯一标识 */
  name: string;
  /** 匹配模式（支持多个正则） */
  patterns: RegExp[];
  /** 风险等级 */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  /** 默认行为 */
  defaultBehavior: 'allow' | 'ask' | 'deny';
  /** 规则类别 */
  category: UnifiedRuleCategory;
  /** 适用平台 */
  platforms: UnifiedRulePlatform[];
  /** 提示消息模板 */
  message: string;
}

// ─── 规则分类 ──────────────────────────────────────────────

/** P1: 删除规则 */
export const DELETION_RULES: UnifiedSecurityRule[] = [
  // Bash
  {
    name: 'rm_root',
    patterns: [/\brm\s+(-[rf]+\s+)*\//i],
    riskLevel: 'high',
    defaultBehavior: 'deny',
    category: 'deletion',
    platforms: ['bash'],
    message: '尝试删除根目录或系统目录',
  },
  {
    name: 'rm_force_recursive',
    patterns: [/\brm\s+(-[rf]+\s+)*\*(\s|$)/i],
    riskLevel: 'high',
    defaultBehavior: 'deny',
    category: 'deletion',
    platforms: ['bash'],
    message: '尝试强制递归删除所有文件',
  },
  // PowerShell
  {
    name: 'ps_recursive_deletion',
    patterns: [
      /remove-item\s+.*-recurse/i,
      /ri\s+.*-recurse/i,
      /rm\s+.*-recurse/i,
      /rm\s+.*-r\b/i,
      /remove-item\s+.*-r\b/i,
      /ri\s+.*-r\b/i,
    ],
    riskLevel: 'high',
    defaultBehavior: 'ask',
    category: 'deletion',
    platforms: ['powershell'],
    message: '检测到 PowerShell 递归删除操作，请确认目标和范围',
  },
  {
    name: 'ps_bulk_deletion',
    patterns: [
      /remove-item\s+.*(?:-recurse|-force)/i,
      /ri\s+.*(?:-recurse|-force)/i,
      /del\s+.*(?:-recurse|-force)/i,
      /erase\s+.*(?:-recurse|-force)/i,
      /rm\s+.*(?:-recurse|-force|-r\b|-f\b)/i,
    ],
    riskLevel: 'high',
    defaultBehavior: 'ask',
    category: 'deletion',
    platforms: ['powershell'],
    message: '检测到 PowerShell 批量删除操作，请确认目标和范围',
  },
  {
    name: 'ps_remove_item_generic',
    patterns: [/(?:remove-item|ri|del|erase|rd|rmdir|rm)\s+/i],
    riskLevel: 'medium',
    defaultBehavior: 'ask',
    category: 'deletion',
    platforms: ['powershell'],
    message: '检测到文件删除操作，请确认目标和范围',
  },
  // cmd.exe
  {
    name: 'cmd_bulk_deletion',
    patterns: [/(?:del|erase|rd|rmdir)\s+\/?(?:s|q)+/i],
    riskLevel: 'high',
    defaultBehavior: 'ask',
    category: 'deletion',
    platforms: ['cmd'],
    message: '检测到 cmd 批量删除操作，请确认目标和范围',
  },
  // 永久删除（不走回收站）
  {
    name: 'permanent_deletion',
    patterns: [
      /remove-item\s+(?!.*-recyclebin)/i, // Remove-Item 未使用 -RecycleBin
      /ri\s+(?!.*-recyclebin)/i,
      /remove-item\s+.*-force/i, // Remove-Item -Force（跳过确认）
      /ri\s+.*-force/i,
    ],
    riskLevel: 'high',
    defaultBehavior: 'ask',
    category: 'deletion',
    platforms: ['powershell'],
    message: '检测到永久删除操作（不走回收站），建议使用 -RecycleBin 参数',
  },
];

/** P1: 格式化规则 */
export const FORMAT_RULES: UnifiedSecurityRule[] = [
  {
    name: 'mkfs',
    patterns: [/\bmkfs\./i],
    riskLevel: 'high',
    defaultBehavior: 'deny',
    category: 'format',
    platforms: ['bash'],
    message: '尝试格式化文件系统',
  },
  {
    name: 'dd_device',
    patterns: [/\bdd\s+.*of=\/dev\//i],
    riskLevel: 'high',
    defaultBehavior: 'deny',
    category: 'format',
    platforms: ['bash'],
    message: '尝试直接写入设备文件',
  },
  {
    name: 'format_volume',
    patterns: [/\bformat\s+/i, /format-(?:volume|drive)\s+/i],
    riskLevel: 'critical',
    defaultBehavior: 'deny',
    category: 'format',
    platforms: ['bash', 'powershell'],
    message: '尝试格式化操作',
  },
];

/** P1: 权限提升规则 */
export const PRIVILEGE_RULES: UnifiedSecurityRule[] = [
  {
    name: 'chmod_777',
    patterns: [/\bchmod\s+(-R\s+)?777\s+\//i],
    riskLevel: 'high',
    defaultBehavior: 'ask',
    category: 'privilege',
    platforms: ['bash'],
    message: '尝试设置危险的文件权限',
  },
  {
    name: 'chown_recursive',
    patterns: [/\bchown\s+.*-R.*\//i],
    riskLevel: 'medium',
    defaultBehavior: 'ask',
    category: 'privilege',
    platforms: ['bash'],
    message: '尝试递归修改文件所有者',
  },
  {
    name: 'userdel',
    patterns: [/\buserdel\b/i],
    riskLevel: 'high',
    defaultBehavior: 'ask',
    category: 'privilege',
    platforms: ['bash'],
    message: '尝试删除用户',
  },
  {
    name: 'sudo_privilege',
    patterns: [/\bsudo\s+/i, /\bsu\s+root/i, /\bpkexec\s+/i, /\bdoas\s+/i],
    riskLevel: 'high',
    defaultBehavior: 'ask',
    category: 'privilege',
    platforms: ['bash'],
    message: '尝试执行权限提升操作',
  },
];

/** P1: 系统规则 */
export const SYSTEM_RULES: UnifiedSecurityRule[] = [
  {
    name: 'shutdown',
    patterns: [/\b(shutdown|poweroff|reboot|halt)\b/i],
    riskLevel: 'high',
    defaultBehavior: 'ask',
    category: 'system',
    platforms: ['bash'],
    message: '尝试执行系统关机/重启命令',
  },
  {
    name: 'fork_bomb',
    patterns: [/:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;?\s*:/],
    riskLevel: 'high',
    defaultBehavior: 'deny',
    category: 'system',
    platforms: ['bash'],
    message: '检测到 Fork 炸弹',
  },
  {
    name: 'iptables',
    patterns: [/\biptables\b/i],
    riskLevel: 'high',
    defaultBehavior: 'ask',
    category: 'system',
    platforms: ['bash'],
    message: '尝试修改防火墙规则',
  },
];

/** P1: 注入/远程执行规则 */
export const INJECTION_RULES: UnifiedSecurityRule[] = [
  {
    name: 'remote_download_exec',
    patterns: [
      /curl\s+.*\|\s*(?:bash|sh)/i,
      /wget\s+.*\|\s*(?:bash|sh)/i,
      /curl\s+.*\|\s*sudo/i,
      /wget\s+.*\|\s*sudo/i,
    ],
    riskLevel: 'high',
    defaultBehavior: 'ask',
    category: 'injection',
    platforms: ['bash'],
    message: '检测到远程下载并执行操作',
  },
  {
    name: 'base64_decode_exec',
    // 2026-10-29（issue #5 样例驱动）：原为 `/base64\s+-d\s+\|/`，要求 `-d` 后**紧跟**管道，
    // 只覆盖 `base64 -d | sh` 这种不常见写法；最常见的 `base64 -d payload.b64 | sh` 反而漏判。
    // 改为「`-d` / `--decode` 之后、管道之前允许有载荷」（口径与 `injectionPatterns.ts` 的同名规则对齐）。
    patterns: [/base64\s+(?:-d|--decode)\b.*\|/i, /echo\s+.*\|\s*base64\s+-d/i],
    riskLevel: 'high',
    defaultBehavior: 'ask',
    category: 'injection',
    platforms: ['bash'],
    message: '检测到 base64 解码执行操作',
  },
  {
    name: 'iex_invoke',
    patterns: [/invoke-expression/i, /\biex\s+/i],
    riskLevel: 'high',
    defaultBehavior: 'deny',
    category: 'injection',
    platforms: ['powershell'],
    message: '检测到 PowerShell 表达式动态执行',
  },
];

/**
 * P3-01: 复合命令检测规则
 * 检测 PowerShell 中通过管道、脚本块、变量传递等方式执行的删除操作
 */
export const COMPOSITE_COMMAND_RULES: UnifiedSecurityRule[] = [
  // 管道传递：Get-ChildItem | Remove-Item
  {
    name: 'pipe_remove_item',
    patterns: [/\|.*remove-item/i, /\|.*ri\b/i, /\|.*del\b(?!-recyclebin)/i],
    riskLevel: 'high',
    defaultBehavior: 'ask',
    category: 'injection',
    platforms: ['powershell'],
    message: '检测到管道传递删除操作，请确认删除范围',
  },
  // ForEach-Object 脚本块：ForEach-Object { Remove-Item $_ }
  {
    name: 'foreach_remove_item',
    patterns: [
      /foreach[-\s]*object\s*\{[^}]*remove-item/i,
      /foreach[-\s]*object\s*\{[^}]*\bri\b/i,
      /%\s*\{[^}]*remove-item/i,
    ],
    riskLevel: 'high',
    defaultBehavior: 'ask',
    category: 'injection',
    platforms: ['powershell'],
    message: '检测到 ForEach-Object 脚本块内删除操作',
  },
  // Invoke-Command -ScriptBlock { Remove-Item ... }
  {
    name: 'invoke_command_remove',
    patterns: [
      /invoke-command.*scriptblock.*remove-item/i,
      /invoke-command.*scriptblock.*\bri\b/i,
    ],
    riskLevel: 'high',
    defaultBehavior: 'ask',
    category: 'injection',
    platforms: ['powershell'],
    message: '检测到 Invoke-Command 远程脚本块内删除操作',
  },
  // & { Remove-Item ... } 调用块
  {
    name: 'call_block_remove',
    patterns: [/&\s*\{.*remove-item/i, /&\s*\{.*\bri\b/i],
    riskLevel: 'high',
    defaultBehavior: 'ask',
    category: 'injection',
    platforms: ['powershell'],
    message: '检测到调用块（& {}）内删除操作',
  },
  // Start-Job -ScriptBlock { Remove-Item ... }
  {
    name: 'start_job_remove',
    patterns: [
      /start-job.*scriptblock.*remove-item/i,
      /start-job.*scriptblock.*\bri\b/i,
    ],
    riskLevel: 'high',
    defaultBehavior: 'ask',
    category: 'injection',
    platforms: ['powershell'],
    message: '检测到 Start-Job 后台任务内删除操作',
  },
  // Invoke-Expression "Remove-Item ..."
  {
    name: 'iex_remove',
    patterns: [/invoke-expression.*remove-item/i, /\biex\s+.*remove-item/i],
    riskLevel: 'high',
    defaultBehavior: 'deny',
    category: 'injection',
    platforms: ['powershell'],
    message: '检测到 Invoke-Expression 动态调用删除操作',
  },
  // 变量传递：$dir = "path"; Remove-Item $dir
  {
    name: 'variable_remove',
    patterns: [/remove-item\s+\$[a-z]/i, /\bri\s+\$[a-z]/i],
    riskLevel: 'medium',
    defaultBehavior: 'ask',
    category: 'injection',
    platforms: ['powershell'],
    message: '检测到变量传递的删除操作（无法预览具体路径）',
  },
];

/** P1: 全规则合并（用于需要遍历所有规则的场景） */
export const ALL_UNIFIED_RULES: UnifiedSecurityRule[] = [
  ...DELETION_RULES,
  ...FORMAT_RULES,
  ...PRIVILEGE_RULES,
  ...SYSTEM_RULES,
  ...INJECTION_RULES,
  ...COMPOSITE_COMMAND_RULES,
];

// ─── 向后兼容（P2：改为从统一规则集投影，不再手抄第二份） ──────────

/**
 * `DANGEROUS_COMMAND_PATTERNS` 原先的 10 条 bash 规则名。
 *
 * P2（`dev_docs/20261027/工具权限体系归一化方案-20261027.md` §5 P2-2）：
 * 这份"第二份危险模式表"只保留**规则名**，pattern / message / riskLevel / behavior
 * 一律从 `ALL_UNIFIED_RULES` 投影 ⇒ 修改规则只需改统一表，不会再出现"两份表漂移"。
 */
const LEGACY_BASH_RULE_NAMES = new Set([
  'rm_root',
  'rm_force_recursive',
  'mkfs',
  'dd_device',
  'fork_bomb',
  'chmod_777',
  'chown_recursive',
  'shutdown',
  'iptables',
  'userdel',
]);

/**
 * 向后兼容视图：BashSecurityAnalyzer 的"私有危险模式层"。
 *
 * 语义与 P2 之前**逐条等价**（仅由逐字手抄改为从统一表派生）。
 */
export const DANGEROUS_COMMAND_PATTERNS: SecurityPattern[] =
  ALL_UNIFIED_RULES.filter((rule) => LEGACY_BASH_RULE_NAMES.has(rule.name)).map(
    (rule) => ({
      name: rule.name,
      pattern: rule.patterns[0]!,
      message: rule.message,
      riskLevel: rule.riskLevel === 'critical' ? 'high' : rule.riskLevel,
      behavior: rule.defaultBehavior,
    })
  );

/**
 * PowerShell 删除命令别名（**单一来源**）。
 *
 * 消费方：`PowerShellTool`（危险模式构造）、`SandboxSecurityChecker`（危险命令集合）。
 * 原先两处各手抄一份（且含 `rrmdir` 拼写），改为统一引用本常量。
 */
export const POWERSHELL_DELETION_ALIASES: readonly string[] = [
  'remove-item',
  'ri',
  'rm',
  'del',
  'erase',
  'rd',
  'rmdir',
  'rrmdir',
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
