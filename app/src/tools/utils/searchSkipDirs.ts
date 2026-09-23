// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 搜索类工具（`grep` / `glob`）共享的"重目录"跳过清单 —— **单一事实来源**（2026-09-22 归一化）。
 *
 * 归一化背景（CS01）：原清单内联在 `GrepTool/grep.ts`（模块私有，仅 grep 单侧生效），
 * **glob 侧完全没有跳过逻辑** ⇒ 从项目根执行双星前缀递归模式时，会连同
 * `app/node_modules` 与 `client/node_modules` 一起遍历（本仓 6.5 万+ 文件）。
 *
 * 实测（2026-09-22，本仓根目录）：`globAsync` 查找单个 `ToolManagerUtils.ts`
 * 耗时 **7960ms**，而命中仅 1 个文件；会话真机日志
 * （`chat-export-1790038432335.md`，2026-09-21T23:22:33Z）中同批 4 个 glob
 * 占满 **55 秒**工具窗口，期间无任何日志输出。
 *
 * 与 `grep.ts` 原有语义保持一致（无条件按目录名跳过），仅额外提供
 * {@link resolveSkipDirs} 供 glob 在**模式显式点名**该目录时豁免（见该函数注释）。
 */

/**
 * 全项目扫描时跳过的构建产物 / 备份 / 缓存目录（2026-09-01 P1 建档，2026-09-22 归一化）。
 *
 * 模型常以 `path: "."` 扫项目根，`target`（Rust 产物）、`node_modules`、`dist` 等
 * 目录文件多且多为二进制或生成物，遍历成本极高且结果无意义。
 */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  'target',
  'dist',
  'build',
  'out',
  'coverage',
  '_migration_backup',
  'backup',
  'backups',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  'cache',
  '.cache',
  'tmp',
  'temp',
  'logs',
  'node_modules',
]);

/**
 * 按 glob 模式解析实际生效的跳过集合。
 *
 * 语义：**模式显式点名**的目录不跳过 —— 否则"去 node_modules 里找文件"这类
 * 合法诉求会永远返回空结果，属于用性能优化制造功能回归。
 *
 * @param pattern glob 模式（反斜杠会先归一为斜杠）
 * @returns 需要跳过的目录名集合；模式未点名任何目录时直接返回 {@link SKIP_DIRS}（零分配）
 */
export function resolveSkipDirs(pattern: string): ReadonlySet<string> {
  const normalized = pattern.replace(/\\/g, '/');
  let exempted: string[] | undefined;
  for (const dir of SKIP_DIRS) {
    if (normalized.includes(dir)) (exempted ??= []).push(dir);
  }
  if (!exempted) return SKIP_DIRS;
  const effective = new Set<string>();
  const exemptSet = new Set(exempted);
  for (const dir of SKIP_DIRS) {
    if (!exemptSet.has(dir)) effective.add(dir);
  }
  return effective;
}
