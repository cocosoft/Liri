/**
 * 硬编码治理 · 共享扫描工具（方案 §8 阶段①「仅上报」）
 *
 * 复用 `scripts/lint-models.ts` 的成熟框架（目录 / 扩展名 / 注释跳过 / 白名单），
 * 为 4 个「仅上报、不阻断」的门禁（lint:consts / lint:endpoints / lint:locale /
 * lint:failmsg-refs）提供**唯一**的扫描与打印实现，避免 4 份重复。
 *
 * 口径（阶段①）：一律 `process.exit(0)` —— 只 warning、不阻断（对齐 R00-003）。
 * 实现约束：Windows 无系统 grep，全部用 Bun/Node 内置 API。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

/** 项目根目录：本文件位于 `scripts/lib/`，故上溯两级 */
export const PROJECT_ROOT = join(import.meta.dir, '..', '..');

/** 扫描目录（与 lint-models.ts 一致：后端 app/src + 前端 client/src） */
export const SCAN_DIRS = [
  join(PROJECT_ROOT, 'app', 'src'),
  join(PROJECT_ROOT, 'client', 'src'),
];

/** 检查的文件扩展名 */
const CHECK_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

/** 递归收集文件（返回**绝对路径**；跳过 node_modules/.git/dist/__tests__） */
export function collectFiles(dir?: string): string[] {
  const results: string[] = [];
  for (const root of dir ? [dir] : SCAN_DIRS) {
    walk(root, results);
  }
  return results;
}

function walk(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === 'dist' ||
      entry.name === '__tests__'
    )
      continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    const ext = entry.name.slice(entry.name.lastIndexOf('.'));
    if (CHECK_EXTENSIONS.has(ext)) out.push(full);
  }
}

/** 归一化为**相对 PROJECT_ROOT** 的 `/` 分隔路径（白名单统一用 `/`） */
export function toRel(abs: string): string {
  return abs.replace(PROJECT_ROOT + sep, '').replaceAll(sep, '/');
}

/** 是否为注释行（行首 `//` / `*` / `/*` / `<!--`） */
export function isCommentLine(line: string): boolean {
  const t = line.trim();
  return (
    t.startsWith('//') ||
    t.startsWith('*') ||
    t.startsWith('/*') ||
    t.startsWith('<!--')
  );
}

/** 读取文件并按行切分（统一 CRLF/LF） */
export function readLines(abs: string): string[] {
  return readFileSync(abs, 'utf-8').split(/\r?\n/);
}

/** 白名单片段匹配（`rel` 含任一片段即算命中；片段统一 `/` 分隔） */
export function matchesWhitelist(rel: string, fragments: string[]): boolean {
  return fragments.some((frag) => rel.includes(frag));
}

/**
 * 统一打印（**永不 `process.exit(1)`** —— 阶段①仅上报）。
 * - 0 条 ⇒ `[lint:X] ✅ 无告警`
 * - >0 条 ⇒ `[lint:X] ⚠️ 仅上报 N 条：` 后逐条 `  文件:行 说明`
 * - 末尾统一 `[lint:X] 结果：WARN（仅上报，不阻断）`
 *
 * @param name   门禁名（`[lint:<name>]`）
 * @param findings 逐条告警（`文件:行 说明`）
 * @param extraLines 置顶的信息行（统计/口径说明），恒打印
 */
export function report(
  name: string,
  findings: string[],
  extraLines: string[] = []
): void {
  const tag = `[lint:${name}]`;
  for (const line of extraLines) console.log(line);
  if (findings.length === 0) {
    console.log(`${tag} ✅ 无告警`);
  } else {
    console.log(`${tag} ⚠️ 仅上报 ${findings.length} 条：`);
    for (const f of findings) console.log(`  ${f}`);
  }
  console.log(`${tag} 结果：WARN（仅上报，不阻断）`);
}
