/**
 * 门禁「可解释性」覆盖自证（2026-11-01）。
 *
 * 背景：`lint:arch` 会给每条违规打印「为什么是问题」，但说明表是**手写**的 ——
 * 新增规则族/规则 id 时漏配**不会被任何门禁发现**，只会静默少打印一行。
 * 本用例把它变成**可测的契约**：
 *   ① 脚本里出现的每个 `ruleId` 都能拿到说明（精确条目或规则族通例）；
 *   ② 每个 `ruleId` 都在 `.trae/rules/architecture-compliance.md` 有定义
 *      （门禁输出里的「规则定义」指针必须指向真实存在的条目）；
 *   ③ 负向对照：未知 id 返回 `null`（宁可不说，也不编造说明）。
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { explainRule } from '../../../scripts/lib/ruleWhy';

const REPO = join(process.cwd(), '..');
const GATE_SRC = join(REPO, 'scripts', 'lint-architecture.ts');
const RULES_DOC = join(REPO, '.trae', 'rules', 'architecture-compliance.md');

/** 门禁脚本里实际会产出的 ruleId 全集 */
function emittedRuleIds(): string[] {
  const src = readFileSync(GATE_SRC, 'utf-8');
  return [
    ...new Set(
      [...src.matchAll(/ruleId:\s*'([A-Z0-9-]+)'/g)].map((m) => m[1]!)
    ),
  ].sort();
}

describe('lint:arch 可解释性覆盖', () => {
  it('每个 ruleId 都有「为什么是问题」（精确条目或规则族）', () => {
    const missing = emittedRuleIds().filter((id) => explainRule(id) === null);
    expect(missing).toEqual([]);
  });

  it('每个 ruleId 都在规则文档里有定义', () => {
    const doc = readFileSync(RULES_DOC, 'utf-8');
    const undocumented = emittedRuleIds().filter((id) => !doc.includes(id));
    expect(undocumented).toEqual([]);
  });

  it('负向对照：未知 ruleId 返回 null（不编造说明）', () => {
    expect(explainRule('R99-999')).toBeNull();
  });

  it('精确条目优先于规则族', () => {
    const exact = explainRule('R00-001');
    expect(exact).not.toBeNull();
    expect(exact!.startsWith('例：')).toBe(true);
  });
});
