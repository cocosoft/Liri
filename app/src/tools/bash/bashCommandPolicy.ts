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
  /\|\s*sh$/,
  /\$\([^)]*\)/,
  /`[^`]+`/,
  /;\s*rm\s+/,
  /&&\s*rm\s+/,
  /\|\|\s*rm\s+/,
  /eval\s*\(/,
  /exec\s+/,
  /source\s+/,
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
 * @param baseCommand S1-5：已归一化的基命令名（见 `commandNormalization.deriveBaseCommand`）
 * @returns 是否允许
 */
export function isBaseCommandAllowed(baseCommand: string): boolean {
  if (!baseCommand) return false;
  return ALLOWED_COMMANDS.has(baseCommand);
}

/**
 * A4（2026-10-09）：高能力解释器命令名集合。
 *
 * 这些命令**能执行任意代码**（`node -e` / `bun -e` / `python -c` / `npm exec` …），
 * 仅凭"在白名单内"不足以视为安全。灰度开关 `BASH_INTERPRETER_GUARD` 开启时，
 * 未批准的此类命令不自动放行，转人工确认（见 execute 内实现）。
 */
export const HIGH_CAPABILITY_INTERPRETERS = new Set([
  'node',
  'bun',
  'npm',
  'npx',
  'yarn',
  'pnpm',
  'deno',
  'pwsh',
  'powershell',
  'python',
  'python3',
  'pip',
  'pip3',
]);

/** 命令的基命令是否为高能力解释器（S1-5：入参为已归一化基命令名，口径同白名单） */
export function isHighCapabilityInterpreter(baseCommand: string): boolean {
  if (!baseCommand) return false;
  return HIGH_CAPABILITY_INTERPRETERS.has(baseCommand);
}

/**
 * B3（2026-10-30，issue #37）：命令是否带**内联代码**开关（`-c` / `-e` / `--eval` /
 * `-Command` / `-EncodedCommand`）。
 *
 * 用途：`BASH_INTERPRETER_GUARD` 只应拦"能把任意代码作为字符串直接执行"的形态；
 * `node script.js`、`python -m pytest` 这类**文件/模块**调用不应被一律升级人工确认
 * （否则只读族也会被 ask 卡悬空）。
 */
export function hasInlineCodeFlag(command: string): boolean {
  if (!command) return false;
  const flags = new Set([
    '-c',
    '-e',
    '--eval',
    '-command',
    '-encodedcommand',
    '-ec',
  ]);
  return command
    .split(/\s+/)
    .some((token) => flags.has(token.toLowerCase().replace(/^["']/, '')));
}
