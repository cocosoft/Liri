/**
 * test-kernel.ts — 内核**秒级回归回路**（P3，`dev_docs/20261023/微内核-core-拆分方案.md` §4-P3）
 *
 * 目的：`bun test`（全量 8k+ 用例 ≈ 3–4 分钟）不适合改内核时的高频回路。本脚本只跑
 * **与内核原语强相关**的原子用例，把本地反馈压到 ~20s，全量仍交给 CI。
 *
 * 纳入范围（**单一事实源就是本文件的 `KERNEL_TEST_SETS`**）：
 *   - `tests/core/**`       内核层自身（身份作用域 / 事件总线 / 相位 / 输出护栏 / 定价 / estop …）
 *   - `tests/execution/**`  四原语投影与执行域状态机（PREPARED/RUNNING/SUSPENDED/SETTLED + 恢复）
 *   - `tests/session/` 中**事件日志持久化**一族（写前持久化 / 修复链 / 二分索引 / 事件派生）
 *
 * **刻意不含**（等 P1-a 落地后再纳入）：`query/dailyBudget*` / `budgetSuspend*` —— 它们当前
 * 直接依赖 `DailyBudgetManager` 单例（config + SQLite + 身份作用域），先纳入会把
 * 配置/落盘噪声带进"秒级"回路；P1-a（计算/存储分离）完成后应改为「吃快照 DTO」的纯用例再收回。
 *
 * 自证：集合为空 ⇒ **退出 1**（防"扫了个空也绿"）；每个集合打印命中数，便于发现口径漂移。
 *
 * 用法：`bun run test:kernel`（在 `app/` 下）。
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

/** 一个纳入集合：整个目录，或按文件名前缀/正则筛选 */
export type KernelTestSet =
  | { dir: string; match?: undefined }
  | { dir: string; match: RegExp };

export const KERNEL_TEST_SETS: readonly KernelTestSet[] = [
  { dir: 'tests/core' },
  { dir: 'tests/execution' },
  {
    dir: 'tests/session',
    match:
      /^(eventLog|EventLogStorage|EventMessageDeriver|MessageToEventMigrator)/,
  },
];

/**
 * 每组文件的**下限**（棘轮，复审 1-B3）：
 * 只允许上调；要下调必须改这里（diff 里可见），防止「路径失效/被摘掉用例」后
 * 集合缩水但循环仍然"绿"。
 *
 * 2026-10-25：`tests/core` 32 → 27 —— 5 个**纯内核**身份用例已迁入
 * `packages/kernel/tests/identity/`（随包走；抽仓后不再丢覆盖），不是"用例被删"。
 */
export const KERNEL_SET_MIN_FILES: Readonly<Record<string, number>> = {
  'tests/core': 27,
  'tests/execution': 13,
  'tests/session': 7,
};

/**
 * 回路耗时上限（秒，复审 1-B3）：超预算 ⇒ 判红，防「集合被塞进重依赖用例后
 * 静默从 20s 涨到 60s/120s 而门禁仍绿」。可用 `KERNEL_LOOP_BUDGET_S` 覆盖
 * （慢机器上临时放宽，但放宽值应写进提交说明）。
 *
 * 定值依据：2026-10-25 本机实测 52 文件 / 437 例 = 20.3s ⇒ 60s ≈ 3x 余量。
 */
export const KERNEL_LOOP_BUDGET_S = 60;

/**
 * 下限检查（纯函数）。
 * @returns 问题描述数组；空数组 = 通过。未登记下限的组不判。
 */
export function checkSetFloors(
  perSet: ReadonlyArray<{ dir: string; count: number }>,
  floors: Readonly<Record<string, number>> = KERNEL_SET_MIN_FILES
): string[] {
  const problems: string[] = [];
  for (const { dir, count } of perSet) {
    const floor = floors[dir];
    if (floor === undefined) continue;
    if (count < floor) problems.push(`${dir}: ${count} < 下限 ${floor}`);
  }
  return problems;
}

/** 耗时是否超预算（纯函数；**等于**预算不算超） */
export function isOverBudget(
  elapsedSeconds: number,
  budgetSeconds: number = KERNEL_LOOP_BUDGET_S
): boolean {
  return elapsedSeconds > budgetSeconds;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      walk(full, out);
    } else if (name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** 按 `KERNEL_TEST_SETS` 收集测试文件（相对 `appRoot` 解析；测试可注入夹具根） */
export function collectKernelTestFiles(appRoot: string): {
  files: string[];
  perSet: Array<{ dir: string; count: number }>;
} {
  const files = new Set<string>();
  const perSet: Array<{ dir: string; count: number }> = [];

  for (const set of KERNEL_TEST_SETS) {
    const abs = join(appRoot, set.dir);
    const matched = walk(abs).filter(
      (full) =>
        !set.match ||
        set.match.test(relative(abs, full).split(/[\\/]/).pop() ?? '')
    );
    for (const file of matched) files.add(file);
    perSet.push({ dir: set.dir, count: matched.length });
  }

  return { files: [...files].sort(), perSet };
}

function main(): void {
  const appRoot = join(import.meta.dir, '..');
  const { files, perSet } = collectKernelTestFiles(appRoot);

  for (const set of perSet) {
    console.log(`  ${set.dir}: ${set.count} 文件`);
  }

  // 守卫 ①（复审 1-B3）：每组文件数不得低于登记下限（防路径漂移/用例被摘后"绿着缩水"）
  const floorProblems = checkSetFloors(perSet);
  if (floorProblems.length > 0) {
    console.error(
      `❌ 内核测试集缩水（棘轮只允许增长）：${floorProblems.join(' · ')}`
    );
    console.error(
      '   处置：恢复被摘掉的用例；确属合理删除 ⇒ 同步下调 scripts/test-kernel.ts 的 KERNEL_SET_MIN_FILES'
    );
    process.exit(1);
  }

  if (files.length === 0) {
    console.error(
      '❌ 内核测试集为空（口径漂移或路径失效）—— 拒绝"扫了个空也算绿"'
    );
    process.exit(1);
  }

  const budget = resolveBudgetSeconds();
  console.log(
    `\n▶ 内核回路：${files.length} 文件（全量留给 CI；耗时上限 ${budget}s）`
  );
  const startedAt = Date.now();
  const result = spawnSync(
    process.execPath,
    ['test', ...files, '--timeout', '30000'],
    { cwd: appRoot, stdio: 'inherit' }
  );
  const elapsed = (Date.now() - startedAt) / 1000;
  console.log(`\n内核回路结束：${elapsed.toFixed(1)}s`);

  // 用例失败优先于耗时判定（先报真正的红；避免"超预算"盖掉失败原因）
  if (result.status !== 0) process.exit(result.status ?? 1);

  // 守卫 ②（复审 1-B3）：耗时上限（防集合混入重依赖用例后静默变慢）
  if (isOverBudget(elapsed, budget)) {
    console.error(
      `❌ 内核回路超预算：${elapsed.toFixed(1)}s > ${budget}s —— 集合里是否混入了重依赖用例？` +
        '（如确属慢机器，用 KERNEL_LOOP_BUDGET_S 临时放宽并在提交说明写明）'
    );
    process.exit(1);
  }

  process.exit(0);
}

/** 解析耗时预算（非法/缺失 ⇒ 默认；非正数视为非法） */
function resolveBudgetSeconds(): number {
  const raw = Number(process.env['KERNEL_LOOP_BUDGET_S']);
  return Number.isFinite(raw) && raw > 0 ? raw : KERNEL_LOOP_BUDGET_S;
}

if (import.meta.main) {
  main();
}
