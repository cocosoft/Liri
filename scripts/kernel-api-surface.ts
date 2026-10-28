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
import { KERNEL_PUBLIC_SUBPATHS } from './lint-kernel-purity';

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

/**
 * **出口 ABI 分级**（AC-14，P3）
 *
 * 判据（确定性，不靠人工台账）：
 *   - `internal`：**内核之外零消费者** ⇒ 尚未成为承诺，可随时改/删；
 *   - `experimental`：有外部消费者，但只经**公开子路径**（`KERNEL_PUBLIC_SUBPATHS`）暴露
 *     —— 子路径本就是「实测无更优替代」的例外面，变动成本低于桶；
 *   - `stable`：有外部消费者且经**桶**（`@openliri/kernel`）暴露 ⇒ 发布即兼容性承诺。
 *
 * 为什么把分级写进**同一份快照**（而不是新建台账）：AC-14 明确「复用
 * `kernel-api-surface.json`，不新建表」；分级的棘轮语义与符号集合一致 ——
 * 任何一级的**变化**（例如某符号从 stable 掉到 internal）都必须 `--write` 并评审。
 */
export type ApiLevel = 'stable' | 'experimental' | 'internal';

/** 消费方扫描根（仓库相对；**不含测试**——测试不是 API 消费者） */
export const CONSUMER_ROOTS = ['app/src', 'app/packages', 'scripts'] as const;

/** 从消费方源码文本中提取「引用了哪些内核符号名」 */
export function extractConsumedNames(text: string): string[] {
  const names = new Set<string>();
  // import/export { a, b as c } from '@openliri/kernel…'
  const clauseRe =
    /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@openliri\/kernel(?:\/[^'"]*)?['"]/g;
  let m: RegExpExecArray | null;
  while ((m = clauseRe.exec(text)) !== null) {
    for (const part of m[1]!.split(',')) {
      const piece = part.trim().replace(/^type\s+/, '');
      if (!piece) continue;
      const name = piece.split(/\s+as\s+/)[0]!.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  // const { a, b: c } = await import('@openliri/kernel…')
  const dynRe =
    /const\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*['"]@openliri\/kernel(?:\/[^'"]*)?['"]\s*\)/g;
  while ((m = dynRe.exec(text)) !== null) {
    for (const part of m[1]!.split(',')) {
      const name = part.trim().split(':')[0]!.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return [...names];
}

/**
 * 计算每个**导出点**（`文件#符号`）的 ABI 级别（纯函数，便于离线断言）。
 *
 * 为什么键到「导出点」而不是「符号名」：同一个名字可能由多个内核文件导出（同名类型/常量
 * 很常见），按名字归一会掩盖「某个文件新增了一个同名出口」这类漂移；按导出点记则
 * 每个出口都必须有级别（AC-14「未登记导出 0」才有意义）。
 *
 * @param entries 快照条目（file + symbols）
 * @param consumed 内核之外被引用的符号名集合
 * @param publicSubpaths 公开子路径首段（`KERNEL_PUBLIC_SUBPATHS`）
 */
export function classifySymbols(
  entries: readonly SurfaceEntry[],
  consumed: ReadonlySet<string>,
  publicSubpaths: readonly string[]
): Record<string, ApiLevel> {
  const subpaths = new Set(publicSubpaths);
  const levels: Record<string, ApiLevel> = {};
  for (const entry of entries) {
    const head = entry.file.split('/')[0]!;
    for (const sym of entry.symbols) {
      const level: ApiLevel = !consumed.has(sym)
        ? 'internal'
        : subpaths.has(head)
          ? 'experimental'
          : 'stable';
      levels[`${entry.file}#${sym}`] = level;
    }
  }
  return levels;
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
  root: string,
  options: {
    consumed?: ReadonlySet<string>;
    publicSubpaths?: readonly string[];
    facades?: readonly string[];
  } = {}
): {
  version: number;
  kernelRoot: string;
  fileCount: number;
  symbolCount: number;
  levelCounts: Record<ApiLevel, number>;
  entries: SurfaceEntry[];
  /** 导出点（`file#symbol`）→ ABI 级别（AC-14：与符号集合同快照，漂移即需评审） */
  levels: Record<string, ApiLevel>;
  /** 应用侧「转出内核」的门面清单（AC-06 转出式重复：存量冻结，新增即阻断） */
  reexportFacades: string[];
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
  const levels = classifySymbols(
    entries,
    options.consumed ?? new Set<string>(),
    options.publicSubpaths ?? []
  );
  const levelCounts: Record<ApiLevel, number> = {
    stable: 0,
    experimental: 0,
    internal: 0,
  };
  for (const level of Object.values(levels)) levelCounts[level] += 1;
  return {
    version: 3,
    kernelRoot: relative(repoRoot, root).split(sep).join('/'),
    fileCount: files.length,
    symbolCount,
    levelCounts,
    entries,
    // 键排序 + 值排序，保证快照逐字节稳定
    levels: Object.fromEntries(
      Object.keys(levels)
        .sort()
        .map((k) => [k, levels[k]!])
    ),
    reexportFacades: [...(options.facades ?? [])].sort(),
  };
}

/** 扫描消费方（仓库内非测试面），返回被引用的内核符号名集合 + 应用侧「转出内核」的门面清单 */
function collectConsumers(): {
  consumed: Set<string>;
  facades: string[];
} {
  const consumed = new Set<string>();
  const facades = new Set<string>();
  // 应用侧把内核符号**再转出**（`export … from '@openliri/kernel…'`）= AC-06 的
  // 「转出式重复」候选：同一符号出现两个公开出口。存量冻结进快照，新增即阻断。
  const facadeRe =
    /export\s+(?:type\s+)?(?:\{[^}]*\}|\*)\s+from\s+['"](@openliri\/kernel[^'"]*)['"]/g;
  for (const rel of CONSUMER_ROOTS) {
    const dir = resolve(repoRoot, rel);
    if (!existsSync(dir)) continue;
    for (const abs of walk(dir)) {
      const relPath = relative(repoRoot, abs).split(sep).join('/');
      if (
        /(^|\/)(tests?|__tests__)\//.test(relPath) ||
        /\.test\.tsx?$/.test(relPath)
      )
        continue;
      const text = readFileSync(abs, 'utf8');
      if (!text.includes('@openliri/kernel')) continue;
      for (const name of extractConsumedNames(text)) consumed.add(name);
      for (const m of text.matchAll(facadeRe)) {
        facades.add(`${relPath} -> ${m[1]}`);
      }
    }
  }
  return { consumed, facades: [...facades].sort() };
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
  const consumers = collectConsumers();
  const surface = buildSurface(files, kernelRoot, {
    consumed: consumers.consumed,
    publicSubpaths: KERNEL_PUBLIC_SUBPATHS,
    facades: consumers.facades,
  });

  if (process.argv.includes('--write')) {
    writeFileSync(SNAPSHOT, `${JSON.stringify(surface, null, 2)}\n`, 'utf8');
    console.log(
      `已写入内核导出面快照：${surface.fileCount} 文件 / ${surface.symbolCount} 个导出符号` +
        `（stable ${surface.levelCounts.stable} · experimental ${surface.levelCounts.experimental} · internal ${surface.levelCounts.internal}）` +
        ` → ${relative(repoRoot, SNAPSHOT)}`
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

  console.log('=== 内核导出面快照（P0-f / AC-14 分级）===');
  console.log(
    `当前 ${surface.fileCount} 文件 / ${surface.symbolCount} 符号 · 快照 ${committed.fileCount} 文件 / ${committed.symbolCount} 符号`
  );

  // AC-14：**未登记导出 0** —— 每个导出符号都必须落进 stable / experimental / internal。
  const unlevelled = Object.keys(surface.levels).filter(
    (k) => !surface.levels[k]
  );
  if (unlevelled.length > 0) {
    console.error(
      `❌ 未登记 ABI 级别的导出 ${unlevelled.length} 个（AC-14 要求 0）：${unlevelled
        .slice(0, 10)
        .join(', ')}`
    );
    return 1;
  }
  console.log(
    `ABI 分级：stable ${surface.levelCounts.stable} · experimental ${surface.levelCounts.experimental} · internal ${surface.levelCounts.internal}`
  );

  // 分级漂移（如 stable → internal）= ABI 收缩/语义变化，同样须评审后 --write
  const levelDrift: string[] = [];
  const prevLevels = committed.levels ?? {};
  for (const [sym, level] of Object.entries(surface.levels)) {
    if (prevLevels[sym] !== level)
      levelDrift.push(`${sym}: ${prevLevels[sym] ?? '(未登记)'} → ${level}`);
  }

  // AC-06：**未登记的转出式重复 = 0**。存量门面冻结在快照里；新增 `export … from kernel` ⇒ 阻断
  const prevFacades = new Set(committed.reexportFacades ?? []);
  const newFacades = surface.reexportFacades.filter((f) => !prevFacades.has(f));
  const droppedFacades = [...prevFacades].filter(
    (f) => !surface.reexportFacades.includes(f)
  );
  console.log(
    `转出面（AC-06）：${surface.reexportFacades.length} 处已登记 · 新增 ${newFacades.length} · 已消除 ${droppedFacades.length}`
  );

  if (
    added.length === 0 &&
    removed.length === 0 &&
    levelDrift.length === 0 &&
    newFacades.length === 0
  ) {
    console.log('✅ 导出面与快照一致');
    return 0;
  }

  if (added.length > 0 || removed.length > 0) {
    console.error(
      `❌ 导出面漂移：新增 ${added.length} / 删除 ${removed.length}（改 API 须评审后 --write 并提交快照）`
    );
    for (const a of added.slice(0, 20)) console.error(`  + ${a}`);
    for (const r of removed.slice(0, 20)) console.error(`  - ${r}`);
    if (added.length > 20 || removed.length > 20)
      console.error('  …（其余省略）');
  }
  if (levelDrift.length > 0) {
    console.error(
      `❌ ABI 分级漂移 ${levelDrift.length} 处（stable ⇄ experimental ⇄ internal 属兼容性语义变化）`
    );
    for (const d of levelDrift.slice(0, 20)) console.error(`  ~ ${d}`);
  }
  if (newFacades.length > 0) {
    console.error(
      `❌ 未登记的转出式重复 ${newFacades.length} 处（AC-06：同一符号不得有两个公开出口）`
    );
    for (const f of newFacades.slice(0, 20)) console.error(`  + ${f}`);
  }
  if (droppedFacades.length > 0) {
    console.log(
      `ℹ️ 已有 ${droppedFacades.length} 处转出面消失（应收紧快照：--write 后提交）`
    );
  }
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
