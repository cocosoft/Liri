/**
 * 许愿式（demand）**硬拒词表**与 killswitch（2026-11-17，B3）。
 *
 * 背景：P0 的 `shouldAutoAllowUnderDemand` 会把「非危险但需审批」的命令降级为自动放行，
 * 而分类器的危险词表并不覆盖 `runas` / `msiexec` / `regsvr32` / `schtasks` /
 * `powershell -enc` 这类**提权、安装、计划任务、解释器**命令（实测均有 ALLOW 记录）。
 * 本模块给出 demand 专用兜底：命中即**保持 ask**（不 deny，不越权收紧非 demand 会话）。
 *
 * 两件事：
 *  ① `isDemandHardDenyCommand`：命令级判定（按段拆分后看命令头 + 全串看子命令模式）；
 *  ② `isDemandAutoAllowEnabled`：`<prefix>DEMAND_AUTO_ALLOW` killswitch（默认开，
 *     显式 `false` 关闭 ⇒ 回到 P0 前的 ask 行为）。
 *
 * 边界：本模块**只影响 demand 降级**；命中与否都不改变 deny / 只读短路 / 规则优先级。
 */

import { productEnvKey } from '@openliri/kernel';
import { splitCommandSegments } from './classifiers/command-segments';

/** 命中即"demand 下不得自动放行"的命令头（小写；不含扩展名） */
export const DEMAND_HARD_DENY_HEADS: ReadonlySet<string> = new Set([
  // 提权 / 安装 / 系统配置
  'runas',
  'msiexec',
  'regsvr32',
  'schtasks',
  'reg',
  'bcdedit',
  'takeown',
  'icacls',
  'cacls',
  'netsh',
  'wmic',
  'sc',
  'psexec',
  // 解释器：任意脚本等价于"任意命令"（P0 非目标明确不放开）
  'powershell',
  'pwsh',
  'cmd',
  'node',
  'python',
  'python3',
  'bash',
  'sh',
  'zsh',
  'iex',
  'invoke-expression',
  // 下载 / 传输（可写任意落点）
  'certutil',
  'bitsadmin',
  'curl',
  'wget',
  'invoke-webrequest',
]);

/** 参数级 / 子命令级模式（对整条命令的小写形式匹配） */
const DEMAND_HARD_DENY_PATTERNS: readonly RegExp[] = [
  /\b(?:npm|yarn|pnpm)\s+(?:publish|login|adduser|token)\b/,
  /\bgit\s+push\b/,
  /\bdocker\s+push\b/,
  /\bkubectl\s+(?:apply|create|delete|replace|patch|scale)\b/,
  /\bsc\s+create\b/,
  /\breg\s+(?:add|delete|import|load|restore)\b/,
  /\bcertutil\b[^\n]*-urlcache\b/,
  /\bpowershell(?:\.exe)?\b[^\n]*-(?:enc|encodedcommand)\b/,
  /\bwmic\b[^\n]*\bcall\s+create\b/,
];

/** 命令分段分隔符 / 前缀剥离由既有 `splitCommandSegments` 统一（不做第二套拆分） */
const WINDOWS_EXE_SUFFIX = /\.(?:exe|cmd|bat|ps1)$/;

/** 取段的命令头：去引号、取首 token、取 basename、去 Windows 可执行后缀、转小写 */
function headOf(segment: string): string {
  const trimmed = segment.trim().replace(/^["']|["']$/g, '');
  const first = trimmed.split(/\s+/)[0] ?? '';
  const base = first.split(/[\\/]/).pop() ?? '';
  return base.replace(WINDOWS_EXE_SUFFIX, '').toLowerCase();
}

/**
 * 该命令在 demand 下是否**禁止自动放行**（命中 ⇒ 调用方回落到 ask）。
 *
 * @param command shell 命令原文（非 shell 工具传空串）
 */
export function isDemandHardDenyCommand(command: string): boolean {
  return explainDemandHardDeny(command).hit;
}

/**
 * 命中解释（2026-11-19，B3 影子观测用）：**唯一判定实现**，`isDemandHardDenyCommand`
 * 只是它的布尔投影 —— 避免为观测再写一套词表匹配（CS01 归一化）。
 *
 * @returns `hit` + 命中方式（`head` 命令头 / `pattern` 子命令模式）与命中值
 */
export function explainDemandHardDeny(command: string): {
  hit: boolean;
  matchedBy?: 'head' | 'pattern';
  matched?: string;
} {
  if (!command.trim()) return { hit: false };
  for (const segment of splitCommandSegments(command)) {
    if (!segment.text.trim()) continue;
    const head = headOf(segment.text);
    if (DEMAND_HARD_DENY_HEADS.has(head)) {
      return { hit: true, matchedBy: 'head', matched: head };
    }
  }
  const lower = command.toLowerCase();
  for (const re of DEMAND_HARD_DENY_PATTERNS) {
    if (re.test(lower)) {
      return { hit: true, matchedBy: 'pattern', matched: re.source };
    }
  }
  return { hit: false };
}

/** demand 自动放行的 killswitch：默认开，显式 `false` 关闭 */
export function isDemandAutoAllowEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const raw = env[productEnvKey('DEMAND_AUTO_ALLOW')];
  return raw?.trim().toLowerCase() !== 'false';
}
