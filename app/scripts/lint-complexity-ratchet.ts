#!/usr/bin/env bun
/**
 * 圈复杂度**重尾离群棘轮门禁**（P2-6 · `dev_docs/20261010/升级优化方案-20261010.md`）
 *
 * 背景：全仓圈复杂度实测分布为**重尾**（`≥40: 76 · ≥60: 30 · ≥80: 12 · ≥100: 7 · max 309`；
 * P99=26）—— 台账 **L-10**。既有 `eslint` 的 `complexity: ['warn', 40]` **只警告不阻断**
 * ⇒ 新增离群无人拦。
 *
 * 本门禁（与 P2-1a 的**行数棘轮**互补）：
 * - 取 **`≥ threshold`（默认 100）** 的函数**计数**，与基线比较；
 * - **只允许减少、不允许增加**（防止"边治理边新增离群"）；
 * - 缩小后须**下调**基线以锁定成果（脚本会提示）。
 *
 * **零新依赖**：复用仓内既有 ESLint（`complexity` 规则，配置已为 `warn 40`
 * ⇒ 其 warning 消息里含**真实数值**）。
 *
 * 负向自证：`COMPLEXITY_BASELINE` 可覆盖（供 `tests/gates/complexityRatchetGate.test.ts`）。
 * 退出码：0 = 未增长；1 = 重尾离群**增加**（或基线非法）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
// P2-6：纯比较核心（供负向自证复用，避免测试里跑 ESLint）
import { compareComplexity } from './complexityRatchetCore';

const APP_DIR = resolve(import.meta.dir, '..');
const SRC_GLOB = 'src/**/*.ts';

interface Baseline {
  version: number;
  threshold: number;
  countAtThreshold: number;
  reference?: Record<string, number>;
  note?: string;
}

const baselinePath = process.env.COMPLEXITY_BASELINE
  ? resolve(process.env.COMPLEXITY_BASELINE)
  : resolve(APP_DIR, '../.trae/architecture/complexity-baseline.json');

if (!existsSync(baselinePath)) {
  console.error(`复杂度基线不存在: ${baselinePath}`);
  process.exit(1);
}
let base: Baseline;
try {
  base = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
} catch (err) {
  console.error(`复杂度基线 JSON 解析失败: ${String(err)}`);
  process.exit(1);
}
if (
  !Number.isFinite(base.threshold) ||
  !Number.isFinite(base.countAtThreshold)
) {
  console.error('复杂度基线缺少 threshold / countAtThreshold');
  process.exit(1);
}

// **探针法**（与 `state-complexity-audit.ts` 同口径）：把 `complexity` 阈值压到 1
// ⇒ ESLint 逐函数**报出真实数值**（配置里原为 `warn 40`，只报 >40 ⇒ 计数会失真）。
const eslint = new ESLint({
  cwd: APP_DIR,
  overrideConfig: { rules: { complexity: ['warn', 1] } },
});
const results = await eslint.lintFiles([SRC_GLOB]);

const re = /complexity of (\d+)/;
const values: number[] = [];
for (const r of results) {
  for (const m of r.messages) {
    if (m.ruleId !== 'complexity') continue;
    const hit = re.exec(m.message);
    if (hit) values.push(Number(hit[1]));
  }
}

const cmp = compareComplexity(values, base);

console.log('=== 圈复杂度重尾离群棘轮（P2-6） ===');
console.log(
  `实测函数 ${values.length} 个 · ≥40: ${cmp.above40} · ≥${base.threshold}: ${cmp.atThreshold}（基线 ${base.countAtThreshold}）`
);
console.log('----------------------------------------');

if (cmp.problems.length > 0) {
  console.error('❌ 存在违规:');
  for (const p of cmp.problems) console.error(`  - ${p}`);
  console.error(
    '（新增离群请先拆分函数，见 .trae/specs/stream-message-flow-split.md）'
  );
  process.exit(1);
}
if (cmp.shrink) console.log(`ℹ️ 已缩小：${cmp.shrink}`);
console.log('✅ 未增长（重尾离群棘轮维持）');
