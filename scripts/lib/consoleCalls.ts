/**
 * `R05-003`（Console 调用基线）· **唯一实现**（`dev_docs/20261013/硬编码统一治理方案-20261013.md` §8 · 双源收敛）。
 *
 * ── 为什么需要它（根因，2026-10-14）──
 * 该规则此前有**两套实现 + 两个阈值**（真·双源，改一处即漂移）：
 *  ① 门禁 `scripts/lint-architecture.ts#checkConsoleBaseline` —— 计数 `log|warn|error|debug`
 *     （4 名）**按出现次数**，阈值读 `scripts/console-baseline.json`（`2045` + `10%` ⇒ 上限 `2250`），
 *     且用 `resolve(process.cwd(), 'scripts', …)` **定位基线**（cwd 漂移 ⇒ 从 `app/` 跑就落到不存在的
 *     `app/scripts/…`，静默回退硬编码 `2045` —— `AR-2` 同型缺陷）；
 *  ② CI `.github/workflows/ci.yml` 内联 `grep` —— 计数 `log|warn|error|info|debug|trace`（6 名）
 *     **按行**，阈值**写死 2034**。
 * ⇒ 本文件把「**扫描面 + 排除规则 + 计数口径 + 阈值读取**」收敛为**一处**；
 *    门禁与 `scripts/check-console-baseline.ts`（CI）**都**引用这里，**不得**再各写一份。
 *
 * ── 口径（统一后）──
 *  · **方法名（并集）**：`log` / `warn` / `error` / `info` / `debug` / `trace`
 *  · **计数**：**按行**（一行多次调用记 1 —— 与原 CI `grep | wc -l` 语义一致）
 *  · **扫描面**：`app/src` 下 `.ts` / `.tsx`（跳 `node_modules` / `.git` / `dist` / `coverage`）
 *  · **排除**：`*.test.*` / `*.spec.*` / `__tests__/` / `*.d.ts`
 *  · **阈值真源**：`scripts/console-baseline.json`（`count` + `threshold`，上限 = `ceil(count×(1+threshold))`）
 *    —— 文件**缺失或非法 ⇒ 抛错**（调用方 fail-closed）：**不得**回退硬编码默认值（那会重新引入第二真源）。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 视为「console 调用」的方法名（**并集**，含原 CI 独有的 `info` / `trace`） */
export const CONSOLE_METHODS = [
  'log',
  'warn',
  'error',
  'info',
  'debug',
  'trace',
] as const;

/** 行级匹配：`console.<method>(` */
export const CONSOLE_CALL_LINE_RE =
  /console\.(?:log|warn|error|info|debug|trace)\s*\(/;

/** 单一真源（相对项目根） */
export const CONSOLE_BASELINE_REL = 'scripts/console-baseline.json';

/** 扫描扩展名 */
const SCAN_EXTENSIONS = ['.ts', '.tsx'];

/** 递归时跳过的目录（构建产物 / 依赖） */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);

/** 基线形态 */
export interface ConsoleBaseline {
  /** 基线值（配合 `threshold` 得到上限） */
  count: number;
  /** 容差比例（0 ⇒ 上限即 `count`） */
  threshold: number;
}

/** 一个待计数的文件（`rel` 为**相对项目根**的 `/` 分隔路径） */
export interface ConsoleScanFile {
  rel: string;
  content: string;
}

/** 单文件命中数 + 合计 */
export interface ConsoleCountResult {
  total: number;
  perFile: Array<{ file: string; count: number }>;
}

/** 归一化为 `/` 分隔（白名单/后缀判定统一用 `/`） */
export function normalizeRel(relPath: string): string {
  return relPath.replaceAll('\\', '/');
}

/**
 * 是否**排除**该文件（**唯一**排除判据）。
 * 口径 = 原门禁与 CI 两套排除的**并集**（只会更严 ⇒ 不会让已通过的 CI 变红）。
 */
export function isConsoleScanExcluded(relPath: string): boolean {
  const rel = normalizeRel(relPath);
  return (
    rel.includes('/node_modules/') ||
    /\.test\.[cm]?[jt]sx?$/.test(rel) ||
    /\.spec\.[cm]?[jt]sx?$/.test(rel) ||
    rel.includes('/__tests__/') ||
    rel.endsWith('.d.ts')
  );
}

/** 按**行**计数（一行内多次调用只记 1） */
export function countConsoleCalls(
  files: ConsoleScanFile[]
): ConsoleCountResult {
  const perFile: Array<{ file: string; count: number }> = [];
  let total = 0;
  for (const f of files) {
    if (isConsoleScanExcluded(f.rel)) continue;
    let n = 0;
    for (const line of f.content.split(/\r?\n/)) {
      if (CONSOLE_CALL_LINE_RE.test(line)) n++;
    }
    if (n > 0) {
      total += n;
      perFile.push({ file: normalizeRel(f.rel), count: n });
    }
  }
  return { total, perFile };
}

/** 递归收集 `dir` 下 `.ts`/`.tsx`（返回**绝对路径**） */
export function collectConsoleScanFiles(dir: string): string[] {
  const out: string[] = [];
  walk(dir, out);
  return out;
}

function walk(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // 目录不存在 / 不可读 ⇒ 当空处理（由调用方保证 dir 存在）
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
}

/**
 * 读取基线（**唯一真源**）。
 * 文件缺失 / JSON 非法 / `count` 非法 ⇒ **抛错**（调用方 fail-closed）。
 *
 * @param projectRoot 项目根
 * @param overridePath 可选：**仅**供负向自证（守卫测试）覆盖基线路径；门禁**不**传它
 */
export function loadConsoleBaseline(
  projectRoot: string,
  overridePath?: string
): ConsoleBaseline {
  const path =
    overridePath ?? join(projectRoot, 'scripts', 'console-baseline.json');
  if (!existsSync(path)) {
    throw new Error(
      `Console 基线不存在：${path} —— R05-003 的**单一事实源**；` +
        '不得回退到硬编码默认值（那会重新引入第二真源）'
    );
  }
  let parsed: Partial<ConsoleBaseline>;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ConsoleBaseline>;
  } catch (err) {
    throw new Error(`Console 基线 JSON 解析失败：${String(err)}`);
  }
  const count = parsed.count;
  const threshold = parsed.threshold ?? 0;
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) {
    throw new Error(`Console 基线 count 非法：${String(count)}`);
  }
  if (
    typeof threshold !== 'number' ||
    !Number.isFinite(threshold) ||
    threshold < 0
  ) {
    throw new Error(`Console 基线 threshold 非法：${String(threshold)}`);
  }
  return { count, threshold };
}

/** 上限 = `ceil(count × (1 + threshold))` */
export function consoleLimit(baseline: ConsoleBaseline): number {
  return Math.ceil(baseline.count * (1 + baseline.threshold));
}
