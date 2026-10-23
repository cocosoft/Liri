#!/usr/bin/env bun
/**
 * kernel-api-surface.ts — 内核**导出面快照**（方案 P0-f）
 *
 * 做什么：扫描内核根（默认 `app/src/core`）下所有 `.ts`，抽取**导出符号名**与条数，
 * 生成确定性快照 `.trae/architecture/kernel-api-surface.json`；CI 用 `--check` 比对。
 *
 * 为什么：抽包后 `core/index.ts` 就是 `@openliri/kernel` 的 public API。
 * 没有快照时，"多导出一个符号"是无声的 —— 而它一旦发布就变成**兼容性承诺**
 * （破坏性变更检测、semver 评审都以此为准，见落地方案 §4-P6）。
 *
 * 口径与已知限制（诚实声明）：
 *   - 只做**文本级**抽取（`export function/class/const/interface/type/enum` 与 `export { … }`），
 *     **不展开** `export * from './x'`（桶再导出由各模块自身的导出计入，避免重复计数）；
 *   - 不解析条件导出、`declare` 合并、重载签名；`as` 别名按**导出名**计；
 *   - 因此它衡量的是「导出面规模与符号集合」，不是 TypeScript 语义层面的 API 等价性。
 *
 * 用法：
 *   bun run scripts/kernel-api-surface.ts --write     # 重写快照（评审后手工提交）
 *   bun run scripts/kernel-api-surface.ts --check     # CI：与快照不一致 ⇒ exit 1
 *
 * 退出码：0 = 一致 / 已写入；1 = 漂移 / 快照缺失 / 执行失败（fail-closed，AR-3）。
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const repoRoot = process.env['KAS_REPO_ROOT']
  ? resolve(process.env['KAS_REPO_ROOT'])
  : resolve(import.meta.dir, '..');
const kernelRoot = process.env['KAS_KERNEL_ROOT']
  ? resolve(process.env['KAS_KERNEL_ROOT'])
  : resolve(repoRoot, 'packages/kernel/src/core');
const SNAPSHOT = process.env['KAS_SNAPSHOT']
  ? resolve(process.env['KAS_SNAPSHOT'])
  : resolve(repoRoot, '.trae/architecture/kernel-api-surface.json');

export interface SurfaceEntry {
  /** 仓库相对路径（正斜杠） */
  file: string;
  /** 该文件导出的符号名（排序去重） */
  symbols: string[];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** 抽取导出符号（文本级；见头注「已知限制」） */
export function extractExportSymbols(text: string): string[] {
  const names = new Set<string>();

  // export [declare] [async] function|class|const|let|var|interface|type|enum NAME
  const declRe =
    /\bexport\s+(?:declare\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(text)) !== null) names.add(m[1]!);

  // export { a, b as c, type d }
  const listRe = /\bexport\s+(?:type\s+)?\{([^}]*)\}/g;
  while ((m = listRe.exec(text)) !== null) {
    for (const part of m[1]!.split(',')) {
      const piece = part.trim().replace(/^type\s+/, '');
      if (!piece) continue;
      const asMatch = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(piece);
      const name = asMatch ? asMatch[1]! : piece.split(/\s+/).pop();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }

  return [...names].sort();
}

/** 生成快照体（稳定排序，便于逐字节比对） */
export function buildSurface(
  files: Array<{ path: string; text: string }>,
  root: string
): {
  version: number;
  kernelRoot: string;
  fileCount: number;
  symbolCount: number;
  entries: SurfaceEntry[];
} {
  const entries: SurfaceEntry[] = [];
  for (const file of files) {
    const symbols = extractExportSymbols(file.text);
    if (symbols.length === 0) continue;
    entries.push({
      file: relative(root, file.path).split(sep).join('/'),
      symbols,
    });
  }
  entries.sort((a, b) => a.file.localeCompare(b.file));
  const symbolCount = entries.reduce((n, e) => n + e.symbols.length, 0);
  return {
    version: 1,
    kernelRoot: relative(repoRoot, root).split(sep).join('/'),
    fileCount: files.length,
    symbolCount,
    entries,
  };
}

function main(): number {
  if (!existsSync(kernelRoot)) {
    console.error(`内核根不存在: ${kernelRoot}`);
    return 1;
  }
  const files = walk(kernelRoot).map((path) => ({
    path,
    text: readFileSync(path, 'utf8'),
  }));
  const surface = buildSurface(files, kernelRoot);

  if (process.argv.includes('--write')) {
    writeFileSync(SNAPSHOT, `${JSON.stringify(surface, null, 2)}\n`, 'utf8');
    console.log(
      `已写入内核导出面快照：${surface.fileCount} 文件 / ${surface.symbolCount} 个导出符号 → ${relative(repoRoot, SNAPSHOT)}`
    );
    return 0;
  }

  if (!existsSync(SNAPSHOT)) {
    console.error(
      `快照不存在（fail-closed）：${SNAPSHOT}；先跑 --write 并提交`
    );
    return 1;
  }

  const committed = JSON.parse(
    readFileSync(SNAPSHOT, 'utf8')
  ) as typeof surface;
  const before = new Map(committed.entries.map((e) => [e.file, e.symbols]));
  const added: string[] = [];
  const removed: string[] = [];
  for (const entry of surface.entries) {
    const prev = before.get(entry.file) ?? [];
    for (const s of entry.symbols)
      if (!prev.includes(s)) added.push(`${entry.file}:${s}`);
    for (const s of prev)
      if (!entry.symbols.includes(s)) removed.push(`${entry.file}:${s}`);
    before.delete(entry.file);
  }
  for (const [file, symbols] of before) {
    for (const s of symbols) removed.push(`${file}:${s}`);
  }

  console.log('=== 内核导出面快照（P0-f）===');
  console.log(
    `当前 ${surface.fileCount} 文件 / ${surface.symbolCount} 符号 · 快照 ${committed.fileCount} 文件 / ${committed.symbolCount} 符号`
  );

  if (added.length === 0 && removed.length === 0) {
    console.log('✅ 导出面与快照一致');
    return 0;
  }

  console.error(
    `❌ 导出面漂移：新增 ${added.length} / 删除 ${removed.length}（改 API 须评审后 --write 并提交快照）`
  );
  for (const a of added.slice(0, 20)) console.error(`  + ${a}`);
  for (const r of removed.slice(0, 20)) console.error(`  - ${r}`);
  if (added.length > 20 || removed.length > 20)
    console.error('  …（其余省略）');
  return 1;
}

if (import.meta.main) {
  try {
    process.exit(main());
  } catch (err) {
    // 检查器崩溃不得当成通过（AR-3）
    console.error(`❌ 内核导出面快照执行失败（不视为通过）: ${String(err)}`);
    process.exit(1);
  }
}
