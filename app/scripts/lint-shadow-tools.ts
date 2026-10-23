/**
 * lint-shadow-tools.ts — 影子工具处置登记门禁（PR-4，2026-10-23）
 *
 * 口径：
 * - **生效面** = `TOOL_NAMES`（生成物，「全量 ∧ 可实例化」）
 * - **声明面** = `TOOL_NAME_CONSTANTS`
 * - **影子工具** = 声明面 − 生效面（当前 11 个）
 *
 * 检查（ERROR 即失败）：
 * 1. 每个影子工具**必须**在 `shadowToolDispositions` 登记（原因 + 处置 + 再评估条件）；
 * 2. 影子工具的 `disposition` **不得**为 `wired`（自相矛盾）；
 * 3. 已进生效面却仍登记为非 `wired` 的条目 ⇒ WARN（提示改成 `wired` 或移除）。
 *
 * 边界：静态只读，不实例化工具（快、无副作用）。
 */
import { SHADOW_TOOL_DISPOSITIONS } from '../src/tools/shadowToolDispositions';
import { TOOL_NAME_CONSTANTS } from '../src/tools/toolNameConstants';
import { TOOL_NAMES } from '../src/constants/toolNames.generated';

function main(): number {
  const declared = new Set<string>(Object.values(TOOL_NAME_CONSTANTS));
  const registered = new Set<string>(TOOL_NAMES);
  const conditional = [...declared].filter((n) => !registered.has(n)).sort();

  const errors: string[] = [];
  const warnings: string[] = [];

  for (const name of conditional) {
    const entry = SHADOW_TOOL_DISPOSITIONS[name];
    if (!entry) {
      errors.push(
        `影子工具 ${name} 未登记处置（请在 shadowToolDispositions.ts 补 reason/disposition/reevaluateWhen）`
      );
      continue;
    }
    if (entry.disposition === 'wired') {
      errors.push(
        `影子工具 ${name} 的 disposition 不应为 'wired'（它不在生效面）`
      );
    }
    if (!entry.reevaluateWhen.trim()) {
      errors.push(`影子工具 ${name} 缺少"再评估触发条件"（reevaluateWhen）`);
    }
  }

  for (const name of Object.keys(SHADOW_TOOL_DISPOSITIONS)) {
    if (!declared.has(name)) {
      warnings.push(`处置表条目 ${name} 已不在声明面（可删除）`);
      continue;
    }
    if (
      registered.has(name) &&
      SHADOW_TOOL_DISPOSITIONS[name].disposition !== 'wired'
    ) {
      warnings.push(
        `处置表条目 ${name} 已进生效面（可改为 'wired' 或删除条目）`
      );
    }
  }

  console.log('=== 影子工具处置门禁（PR-4） ===');
  console.log(
    `声明面 ${declared.size} · 生效面 ${registered.size} · 影子工具 ${conditional.length} · 已登记 ${Object.keys(SHADOW_TOOL_DISPOSITIONS).length}`
  );
  if (conditional.length > 0) {
    console.log(
      `影子工具：${conditional
        .map(
          (n) => `${n}(${SHADOW_TOOL_DISPOSITIONS[n]?.disposition ?? '未登记'})`
        )
        .join(', ')}`
    );
  }
  for (const w of warnings) console.warn(`[WARN] ${w}`);
  for (const e of errors) console.error(`[ERROR] ${e}`);

  if (errors.length > 0) {
    console.error('存在 ERROR 级别违规，请修复后重新提交。');
    return 1;
  }
  console.log('✅ 通过（影子工具均已登记处置，且无自相矛盾）');
  return 0;
}

process.exit(main());
