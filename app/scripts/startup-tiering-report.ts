#!/usr/bin/env bun
/**
 * startup-tiering-report.ts — 内核瘦身 **P1a 分级报告**（只读分析工具，**不改任何运行时行为**）
 *
 * 输入：P0 取证件产出的 `startup-surface-*.json`（`LIRI_STARTUP_REPORT=1` 启动一次即可得到）
 * 输出：Markdown 候选表（stdout），按"**批次初始化耗时**"降序，并附三列判据：
 *   ① `hasRealInit`：该模块在 `ModuleDefinitions.ts` 的 `initialize()` 里是否真的 `await import(...)`
 *      —— `false` ⇒ 初始化只是状态记账，降级到 ON_DEMAND 后**没有"现加载"的代价**；
 *   ② `staticRefs`：`app/src` 内对它（`@modules/<id>` 或相对路径）的**静态** import 引用数；
 *   ③ `startupRefs`：其中**来自启动面（critical）文件**的引用数 —— 只要 > 0，说明代码在启动图里
 *      已被静态拉进来，**降级不会省加载**（这是"批次降级收益有限"的结构性原因）。
 *
 * 口径声明（重要）：本工具是**启发式静态文本匹配**（不建 AST、不跑 bundler metafile），
 * 只用于给 P1a 候选排序与复核，**不作为门禁**，也不得据此直接改 `LAZY_MODULE_STRATEGY`。
 *
 * 用法：`bun run scripts/startup-tiering-report.ts <startup-surface.json>`（在 `app/` 下）
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const APP_DIR = resolve(import.meta.dir, '..');
const SRC_DIR = join(APP_DIR, 'src');

interface SurfaceModule {
  moduleId: string;
  tier: string;
  status: string | null;
  initStartOffsetMs: number | null;
  initDurationMs: number | null;
}

interface SurfaceReport {
  v: number;
  generatedAt: string;
  counts: Record<string, number>;
  deferredWindow: { durationMs: number | null };
  modules: SurfaceModule[];
}

interface RefStat {
  /** 静态 import 引用总数（`from '…'`） */
  staticRefs: number;
  /** 动态 import 引用总数（`import('…')`） */
  dynamicRefs: number;
  /**
   * 来自**启动面（critical 文件）**的**静态**引用数
   *
   * 只有这一列能说明"代码已被拉进启动图"；启动面里的 `import('…')` 是懒的，不拉图。
   */
  startupStaticRefs: number;
  /** 来自启动面的动态引用数（懒加载 ⇒ 不拉启动图） */
  startupDynamicRefs: number;
}

const reportPath = process.argv[2];
if (!reportPath || !existsSync(reportPath)) {
  console.error(
    '用法：bun run scripts/startup-tiering-report.ts <startup-surface.json>'
  );
  console.error(
    '（该文件由 LIRI_STARTUP_REPORT=1 启动一次生成，默认在 {dataDir}/startup-surface/ 下）'
  );
  process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, 'utf-8')) as SurfaceReport;

/** 文件路径 → 模块 id（`src/<top>/…` ⇒ `<top>`；`src/main.ts` ⇒ `(entry)`） */
function moduleIdOfFile(absFile: string): string {
  const rel = relative(SRC_DIR, absFile);
  if (rel.startsWith('..')) return '(outside)';
  const top = rel.split(sep)[0];
  return rel.includes(sep) ? top : '(entry)';
}

/** 递归收集 src 下的 ts/tsx（跳过 node_modules 与 __tests__） */
function collectSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) {
        if (entry === 'node_modules' || entry === '__tests__') continue;
        walk(abs);
        continue;
      }
      if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(abs);
    }
  };
  walk(SRC_DIR);
  return out;
}

/** 归一化 import 说明符 → 模块 id（仅项目内；第三方包返回 null） */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  if (specifier.startsWith('@modules/')) {
    const id = specifier.slice('@modules/'.length).split('/')[0];
    return id || null;
  }
  if (specifier.startsWith('.')) {
    const abs = resolve(fromFile, '..', specifier);
    if (!abs.startsWith(SRC_DIR)) return null;
    const id = moduleIdOfFile(abs);
    return id === '(entry)' ? null : id;
  }
  return null;
}

const STATIC_IMPORT_RE = /from\s+['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** 统计每个模块被静态 / 动态 / 启动面引用的次数 */
function collectRefStats(
  files: readonly string[],
  tierOf: (moduleId: string) => string
): Map<string, RefStat> {
  const stats = new Map<string, RefStat>();
  const bump = (id: string, key: keyof RefStat): void => {
    const cur = stats.get(id) ?? {
      staticRefs: 0,
      dynamicRefs: 0,
      startupStaticRefs: 0,
      startupDynamicRefs: 0,
    };
    cur[key] += 1;
    stats.set(id, cur);
  };

  for (const file of files) {
    const text = readFileSync(file, 'utf-8');
    const importerId = moduleIdOfFile(file);
    const fromStartup = tierOf(importerId) === 'critical';

    for (const m of text.matchAll(STATIC_IMPORT_RE)) {
      const id = resolveSpecifier(m[1], file);
      if (!id) continue;
      bump(id, 'staticRefs');
      if (fromStartup) bump(id, 'startupStaticRefs');
    }
    for (const m of text.matchAll(DYNAMIC_IMPORT_RE)) {
      const id = resolveSpecifier(m[1], file);
      if (!id) continue;
      bump(id, 'dynamicRefs');
      if (fromStartup) bump(id, 'startupDynamicRefs');
    }
  }
  return stats;
}

/**
 * `ModuleDefinitions.ts` 里各模块的 `initialize()` 是否含动态 import
 *
 * 判据：从模块键那一行开始做花括号配平，块内出现 `await import(` / `import(` 即视为"真实初始化"。
 * 这是**文本启发式**（不解析 TS AST），用于排序而非门禁。
 */
function scanRealInit(): Map<string, boolean> {
  const file = join(SRC_DIR, 'modules', 'ModuleDefinitions.ts');
  const lines = readFileSync(file, 'utf-8').split('\n');
  const result = new Map<string, boolean>();

  const keyRe = /^\s{2}'?([a-zA-Z][\w-]*)'?:\s*\{\s*$/;
  for (let i = 0; i < lines.length; i++) {
    const hit = keyRe.exec(lines[i]);
    if (!hit) continue;
    const moduleId = hit[1];
    let depth = 1;
    let hasImport = false;
    for (let j = i + 1; j < lines.length && depth > 0; j++) {
      const line = lines[j];
      if (/\bimport\s*\(/.test(line)) hasImport = true;
      for (const ch of line) {
        if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
      }
    }
    // 同名键可能重复出现（极少），以"任一实现含 import"为准
    result.set(moduleId, (result.get(moduleId) ?? false) || hasImport);
  }
  return result;
}

const tierOf = (moduleId: string): string =>
  report.modules.find((m) => m.moduleId === moduleId)?.tier ?? 'unknown';

const refStats = collectRefStats(collectSourceFiles(), tierOf);
const realInit = scanRealInit();

const batch = report.modules
  .filter((m) => m.tier === 'deferred-batch')
  .sort((a, b) => (b.initDurationMs ?? 0) - (a.initDurationMs ?? 0));

/** 结论列（顺序即优先级：先看启动面**静态**依赖，再看是否有真实初始化） */
function verdictOf(m: SurfaceModule): string {
  const ref = refStats.get(m.moduleId);
  const hasReal = realInit.get(m.moduleId) ?? false;
  const startupStatic = ref?.startupStaticRefs ?? 0;
  if (startupStatic > 0) {
    return `不建议（启动面**静态**引用 ${startupStatic} 处 ⇒ 代码已在启动图，降级不省加载）`;
  }
  if (!hasReal) {
    return '候选降级（纯记账 initialize + 无启动面静态依赖）';
  }
  return '可观察（有真实初始化动作，降级会把加载推迟到首请求）';
}

const lines: string[] = [];
lines.push('# 内核瘦身 P1a · BATCH → ON_DEMAND 分级报告');
lines.push('');
lines.push(
  `> 数据来源：\`${relative(APP_DIR, reportPath).split(sep).join('/')}\`（P0 取证件，生成于 ${report.generatedAt}）`
);
lines.push(
  `> 批次窗口：${report.deferredWindow.durationMs ?? 0} ms；模块总数 ${report.counts['total'] ?? '?'}（batch ${report.counts['deferredBatch'] ?? '?'}）`
);
lines.push(
  '> 口径：本表是**启发式静态匹配**（非 AST / 非 metafile），仅用于候选排序与复核，**不改任何行为**。'
);
lines.push('');
lines.push(
  '| # | 模块 | 初始化耗时 (ms) | initialize 有真实 import | 静态引用 | 启动面静态 | 启动面动态 | 结论 |'
);
lines.push('|---|---|---:|---|---:|---:|---:|---|');
batch.forEach((m, idx) => {
  const ref = refStats.get(m.moduleId);
  lines.push(
    `| ${idx + 1} | \`${m.moduleId}\` | ${m.initDurationMs ?? 0} | ${
      (realInit.get(m.moduleId) ?? false) ? '是' : '否'
    } | ${ref?.staticRefs ?? 0} | ${ref?.startupStaticRefs ?? 0} | ${
      ref?.startupDynamicRefs ?? 0
    } | ${verdictOf(m)} |`
  );
});

const candidates = batch.filter((m) => verdictOf(m).startsWith('候选降级'));
const blocked = batch.filter((m) => verdictOf(m).startsWith('不建议'));
const observe = batch.filter((m) => verdictOf(m).startsWith('可观察'));

lines.push('');
lines.push('## 汇总');
lines.push('');
lines.push(
  `- 候选降级：**${candidates.length}** 个${candidates.length ? `（${candidates.map((m) => '`' + m.moduleId + '`').join('、')}）` : ''}`
);
lines.push(`- 不建议：**${blocked.length}** 个（启动面已静态依赖）`);
lines.push(`- 可观察（有真实初始化）：**${observe.length}** 个`);
lines.push('');
lines.push(
  '> 注意：即便全部候选降级，按 P0 基线也只能减少**模块数**（61 → 更少），'
);
lines.push(
  '> **不减少**启动耗时 —— 因为主要成本是静态求值（约 1.75 s）与必需模块初始化（约 1.0–1.2 s）。'
);

console.log(lines.join('\n'));
