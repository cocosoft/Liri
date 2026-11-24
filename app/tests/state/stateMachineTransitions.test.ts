/**
 * R09-008（治理方案 P0-2，2026-11-24）：转移规则表**自洽**守卫。
 *
 * 缺口：目录此前只有 `hasTransitionFn: boolean`，规则表与状态集漂移无人发现
 * （实证：`StreamStateTransition` 类型联合缺 `ERROR→STREAMING`，而规则表允许）。
 *
 * 本测试对**所有登记了 `transitionRules` 锚点**的机器断言：
 * ① 规则表**键集合 = `states` 集合**（无孤儿状态、无未登记目标键）；
 * ② 每个转移**目标 ∈ `states`**（无拼写漂移 / 幽灵目标）；
 * ③ **非终态**必须至少有一条出边（无"活着的死胡同"）。
 *
 * 关于终态口径（**如实**）：引擎 `computeDefaultTerminal` 用"出度 0"推导，但有多台机器
 * （`task` / `stream` / `backgroundTask`）显式传 `isTerminal` 且允许终态**复位/重试**回初始态
 * ⇒ 本门禁**不**要求"终态出度为 0"，只要求"非终态有出边"。
 */
import { describe, expect, it } from 'bun:test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { STATE_MACHINES } from '@openliri/infra/state/engine/stateMachineCatalog';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

type Rules = Record<string, readonly string[]>;

async function loadRules(module: string, exportName: string): Promise<Rules> {
  const mod = (await import(
    pathToFileURL(join(REPO_ROOT, module)).href
  )) as Record<string, unknown>;
  const value = mod[exportName];
  if (typeof value !== 'object' || value === null) {
    throw new Error(`规则表锚点不存在: ${module}#${exportName}`);
  }
  return value as Rules;
}

describe('R09-008 转移规则自洽（登记了 transitionRules 的机器）', () => {
  const registered = STATE_MACHINES.filter((m) => m.transitionRules);

  it('至少覆盖 4 台机器（防"锚点全失效 ⇒ 空跑全绿"，AR-3）', () => {
    expect(registered.length).toBeGreaterThanOrEqual(4);
  });

  for (const m of registered) {
    it(`${m.id}：键集合 = states，目标 ⊆ states，非终态有出边`, async () => {
      const rules = await loadRules(
        m.transitionRules!.module,
        m.transitionRules!.exportName
      );
      const states = new Set(m.states);
      const ruleKeys = new Set(Object.keys(rules));

      // ① 双向覆盖：规则表键 == states（不允许任一方向缺失）
      const missingKeys = [...states].filter((s) => !ruleKeys.has(s));
      const extraKeys = [...ruleKeys].filter((s) => !states.has(s));
      expect({ id: m.id, missingKeys }).toEqual({ id: m.id, missingKeys: [] });
      expect({ id: m.id, extraKeys }).toEqual({ id: m.id, extraKeys: [] });

      // ② 目标必须是已登记状态
      const badTargets: string[] = [];
      for (const [from, targets] of Object.entries(rules)) {
        for (const to of targets) {
          if (!states.has(to)) badTargets.push(`${from}→${to}`);
        }
      }
      expect({ id: m.id, badTargets }).toEqual({ id: m.id, badTargets: [] });

      // ③ 非终态不得是死胡同（终态允许"复位/重试"出边，见文件头口径）
      const terminal = new Set(m.terminalStates);
      const deadEnds = m.states.filter(
        (s) => !terminal.has(s) && (rules[s]?.length ?? 0) === 0
      );
      expect({ id: m.id, deadEnds }).toEqual({ id: m.id, deadEnds: [] });
    });
  }
});
