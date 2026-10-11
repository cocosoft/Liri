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
  'npx',
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
