/**
 * `R05-003`（Console 调用基线）· **检查入口**（CI 用）。
 *
 * 口径与**唯一实现** `scripts/lib/consoleCalls.ts`（扫描面 / 排除 / 按行计数 / 阈值读取）完全一致 ——
 * 本文件**只**做「跑一次 + 打印 + 给退出码」，**不得**另写计数或另设阈值。
 *
 * 背景（双源收敛，2026-10-14）：此处原为 `.github/workflows/ci.yml` 的**内联 `grep`**
 * （6 名/按行）与门禁的 `checkConsoleBaseline`（4 名/按次、阈值 `2045×1.1`）**并存**，
 * 阈值与计数口径均不同 ⇒ 改一处即漂移。现两处共用 `lib/consoleCalls.ts` + 单一真源
 * `scripts/console-baseline.json`。
 *
 * 运行：`bun run scripts/check-console-baseline.ts`（仓库根）
 * 退出码：超上限 ⇒ `1`；基线缺失/非法 ⇒ `1`（fail-closed）；否则 `0`。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CONSOLE_BASELINE_REL,
  collectConsoleScanFiles,
  consoleLimit,
  countConsoleCalls,
  loadConsoleBaseline,
} from './lib/consoleCalls';

/** 项目根：本文件位于 `scripts/`，故上溯一级 */
const PROJECT_ROOT = join(import.meta.dir, '..');

/** 扫描根（与门禁同一面：`app/src`） */
const SCAN_ROOT = join(PROJECT_ROOT, 'app', 'src');

function main(): never {
  if (!existsSync(SCAN_ROOT)) {
    console.error(`❌ 找不到扫描目录：${SCAN_ROOT}`);
    process.exit(1);
  }

  let baseline;
  try {
    // 负向自证用：`CONSOLE_BASELINE_OVERRIDE=<path>` 覆盖基线路径（门禁**不**支持该旁路）
    baseline = loadConsoleBaseline(
      PROJECT_ROOT,
      process.env.CONSOLE_BASELINE_OVERRIDE
    );
  } catch (err) {
    console.error(`❌ ${String(err)}`);
    console.error(`   真源：${CONSOLE_BASELINE_REL}`);
    process.exit(1);
  }

  const files = collectConsoleScanFiles(SCAN_ROOT).map((abs) => ({
    rel: abs.slice(PROJECT_ROOT.length + 1),
    content: readFileSync(abs, 'utf-8'),
  }));
  const { total, perFile } = countConsoleCalls(files);
  const limit = consoleLimit(baseline);

  console.log(
    `[R05-003 Console 基线] 当前 ${total} 行（基线: ${baseline.count}，` +
      `容差: ${Math.round(baseline.threshold * 100)}%，上限: ${limit}）；` +
      `扫描 ${files.length} 个文件`
  );

  if (total > limit) {
    console.error(
      `❌ Console 调用超上限：${total} > ${limit}（R05-003；请把新日志迁移到 Logger，或说明后调整基线）`
    );
    perFile.sort((a, b) => b.count - a.count);
    console.error('   调用最多的文件:');
    for (const f of perFile.slice(0, 5)) {
      console.error(`     ${f.file}: ${f.count} 行`);
    }
    process.exit(1);
  }

  console.log('✅ Console 调用在上限内');
  // 显式退出（台账 N-16 / N-49 约定：入口脚本必须主动结束进程）
  process.exit(0);
}

main();
