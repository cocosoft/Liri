// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * bashCommandPolicy — Bash 命令**策略数据 + 纯判据**（G18，2026-10-11）
 *
 * 自 `BashTool.ts` **纯搬迁**（只搬不改）抽出的内聚单元：危险命令/危险模式/白名单/高能力解释器
 * 四张**静态表**与其**无副作用判据**。抽出的目的：缩小 `BashTool.ts` 的"上帝对象"体量，
 * 并让安全策略**可被独立引用/单测**（BashTool 仍是唯一执行入口，语义不变）。
 *
 * ⚠️ 本模块是**数据与纯函数**：不得引入 IO / 状态 / 日志（保持可静态审计）。
 */

// P1（2026-11-07）：只读族与白名单必须同源 —— 见 `isBaseCommandAllowed` 注释
import { READ_ONLY_BASE_COMMANDS } from '@openliri/infra/security';

/**
 * 危险命令列表 - 对标CC源码安全策略
 */
export const DANGEROUS_COMMANDS = [
  'rm -rf',
  'sudo',
  'su',
  'chmod',
  'chown',
  'dd',
  'mkfs',
  'fdisk',
  'format',
  'shutdown',
  'reboot',
  'poweroff',
  'kill',
  'killall',
  'pkill',
  'openssl',
  'ssh-keygen',
  'passwd',
  'useradd',
  'userdel',
  'groupadd',
  'groupdel',
  'usermod',
  'groupmod',
  'chroot',
  'mount',
  'umount',
  'systemctl',
  'service',
  'init',
];

/**
 * 危险模式列表（正则表达式）- 对标CC源码
 */
export const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,
  /:\(\)\s*\{\s*:\|\s*:\s*&\s*\};\s*:/,
  />\s*\/dev\/null/,
  // P1（2026-11-22）：管道进**任意 POSIX 壳**都属结构性风险（`curl … | sh` 的同类）。
  // 旧模式只认 `| sh` ⇒ `| dash` / `| bash` / `| ksh` 落「含非只读段 ⇒ ask」，
  // 与"下载即执行"的风险等级不匹配。
  /\|\s*(?:sh|bash|dash|zsh|ksh|mksh|ash|fish)$/,
  /\$\([^)]*\)/,
  /`[^`]+`/,
  /;\s*rm\s+/,
  /&&\s*rm\s+/,
  /\|\|\s*rm\s+/,
  /eval\s*\(/,
  // P1（2026-11-07 真机）：`exec` / `source` 只在**命令位**（行首或 `; | & (` 之后）才算
  // 危险，否则只读命令的搜索词会被误杀 —— 实测 `grep -rn "exec " src` 被硬拒
  // 「检测到危险命令模式」（引号内是搜索词，不是被执行的命令）。
  /(?:^|[;&|(]\s*)exec\s+/,
  /(?:^|[;&|(]\s*)source\s+/,
];

/**
 * B2-3（2026-10-30，issue #36）：把**引号内**的内容挖空（保留引号本身），只留裸露的
 * 命令文本。
 *
 * 用途：`powershell|pwsh -Command "…"` 的内层脚本由 PowerShell 安全链
 * （`checkPowerShellWrapper` → `evaluatePowerShellSecurity`）判定；bash 侧若再拿
 * **整串文本**过 `DANGEROUS_PATTERNS`，会把脚本里的 `$(…)` / `exec ` 等字面量
 * 当危险（真机 3 次 `dangerous_pattern` 误伤只读统计脚本）。
 *
 * ⚠️ 只对「单条 PowerShell 包裹」使用（见 `bashSecurityGate.checkBashDangerousCommand`）：
 * 多段形态的兄弟段未经 PowerShell 链验证 ⇒ 必须保持原文扫描。
 */
export function maskQuotedSegments(command: string): string {
  let out = '';
  let quote: '"' | "'" | null = null;
  for (const ch of command) {
    if (quote) {
      if (ch === quote) {
        quote = null;
        out += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * 安全命令白名单（F3 修复）
 * 仅允许以这些基命令开头的命令执行，防止任意命令注入
 * 注意：路径类命令（如 ./node_modules/.bin/xxx）也需处理
 */
export const ALLOWED_COMMANDS = new Set([
  // 开发工具
  'npm',
  'npx',
  'node',
  'bun',
  'yarn',
  'pnpm',
  // 版本控制
  'git',
  // 文件查看（只读）
  'dir',
  'ls',
  'pwd',
  'type',
  'cat',
  'echo',
  'findstr',
  'grep',
  'find',
  // 目录操作
  'cd',
  'mkdir',
  'md',
  // 文件操作
  'copy',
  'move',
  'ren',
  'rename',
  // 网络诊断
  'ping',
  'nslookup',
  'tracert',
  'ipconfig',
  // 系统信息
  'ver',
  'set',
  'whoami',
  'hostname',
  'where',
  // 构建工具
  'make',
  'cargo',
  'rustc',
  'tsc',
  // PowerShell（安全参数）
  'pwsh',
  'powershell',
  // 环境变量查看
  'printenv',
  'env',
  // Python
  'python',
  'python3',
  'pip',
]);

/**
 * 检查命令的基命令是否在白名单中
 *
 * P1（2026-11-07 真机）：白名单与**只读族**（`READ_ONLY_BASE_COMMANDS`）此前是两套不一致的清单
 * ⇒ `rg` / `head` / `wc` / `tree` / `tasklist` 被分析器判「只读放行」后，仍在本门被硬拒
 * 「命令不在允许列表中」。只读族是同一事实源（`security/readOnlyCommands.ts`），此处并入。
 *
 * @param baseCommand S1-5：已归一化的基命令名（见 `commandNormalization.deriveBaseCommand`）
 * @returns 是否允许
 */
export function isBaseCommandAllowed(baseCommand: string): boolean {
  if (!baseCommand) return false;
  return (
    ALLOWED_COMMANDS.has(baseCommand) ||
    READ_ONLY_BASE_COMMANDS.has(baseCommand)
  );
}

/**
 * A4（2026-10-09）：高能力解释器命令名集合 + 判据。
 *
 * 2026-11-21：实体下沉到 `@openliri/infra/permission/commandPatterns`
 * （service 层也要用「解释器 ⇒ 精确匹配」生成审批规则，不能反向 import app）。
 * 本文件仅 re-export，既有调用方（`bashSecurityGate` 等）零改动。
 */
export {
  HIGH_CAPABILITY_INTERPRETERS,
  isHighCapabilityInterpreter,
  hasInlineCodeFlag,
} from '@openliri/infra/permission/commandPatterns';
