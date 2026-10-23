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

  if (files.length === 0) {
    console.error(
      '❌ 内核测试集为空（口径漂移或路径失效）—— 拒绝"扫了个空也算绿"'
    );
    process.exit(1);
  }

  console.log(`\n▶ 内核回路：${files.length} 文件（全量留给 CI）`);
  const startedAt = Date.now();
  const result = spawnSync(
    process.execPath,
    ['test', ...files, '--timeout', '30000'],
    { cwd: appRoot, stdio: 'inherit' }
  );
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n内核回路结束：${elapsed}s`);
  process.exit(result.status ?? 1);
}

if (import.meta.main) {
  main();
}
