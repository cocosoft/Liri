/**
 * CRITICAL 清单棘轮 · **负向自证**（内核瘦身 P2）
 *
 * 复用纯逻辑（`app/scripts/criticalModulesCore.ts`），不跑真实门禁（保测试快）。
 * 断言（对应方案 §3 B3 三条验收）：
 *  ① 持平 ⇒ 通过；
 *  ② **新增 CRITICAL 未报备 ⇒ 必报**（棘轮只允许收窄）；
 *  ③ 收窄 ⇒ 通过并提示下调基线；
 *  ④ 登记为 CRITICAL 但无理由 ⇒ 必报；
 *  ⑤ 初始化顺序里的模块未登记策略 ⇒ 必报（否则任何阶段都不会初始化）；
 *  ⑥ 基线自身重复 ⇒ 必报（不得静默取第一条）；
 *  ⑦ **反向差集**：已登记策略但不在初始化顺序 ⇒ 必报（与 ⑤ 对称）。
 */
import { describe, expect, it } from 'bun:test';

import {
  compareCriticalModules,
  toCriticalModulesBaseline,
  type CriticalModuleEntry,
} from '../../scripts/criticalModulesCore.js';

const ORDER = ['core', 'ai', 'analytics', 'session'];
const DECLARED = [...ORDER];

const CURRENT: CriticalModuleEntry[] = [
  { id: 'core', reason: '启动必需' },
  { id: 'ai', reason: '核心 AI 功能' },
];

function baselineOf(entries: CriticalModuleEntry[]) {
  return toCriticalModulesBaseline(entries, '2026-10-21');
}

describe('CRITICAL 清单棘轮 · 负向自证', () => {
  it('持平 ⇒ 无违规、无提示', () => {
    const comparison = compareCriticalModules(
      CURRENT,
      baselineOf(CURRENT),
      DECLARED,
      ORDER
    );
    expect(comparison.violations).toEqual([]);
    expect(comparison.hints).toEqual([]);
    expect(comparison.added).toEqual([]);
    expect(comparison.removed).toEqual([]);
  });

  it('**新增 CRITICAL 未报备** ⇒ 必报（启动面回涨）', () => {
    const comparison = compareCriticalModules(
      [...CURRENT, { id: 'analytics', reason: '分析功能启动即用' }],
      baselineOf(CURRENT),
      DECLARED,
      ORDER
    );
    expect(comparison.added).toEqual(['analytics']);
    expect(
      comparison.violations.some(
        (v) => v.includes('analytics') && v.includes('基线未报备')
      )
    ).toBe(true);
  });

  it('收窄 ⇒ 通过并提示下调基线', () => {
    const comparison = compareCriticalModules(
      [{ id: 'core', reason: '启动必需' }],
      baselineOf(CURRENT),
      DECLARED,
      ORDER
    );
    expect(comparison.violations).toEqual([]);
    expect(comparison.removed).toEqual(['ai']);
    expect(comparison.hints.some((h) => h.includes('--update'))).toBe(true);
  });

  it('登记为 CRITICAL 但理由为空 ⇒ 必报', () => {
    const comparison = compareCriticalModules(
      [{ id: 'core', reason: '   ' }],
      baselineOf([{ id: 'core', reason: '   ' }]),
      DECLARED,
      ORDER
    );
    expect(
      comparison.violations.some(
        (v) => v.includes('core') && v.includes('没有说明理由')
      )
    ).toBe(true);
  });

  it('初始化顺序中的模块未登记策略 ⇒ 必报（不会被任何阶段初始化）', () => {
    const comparison = compareCriticalModules(
      CURRENT,
      baselineOf(CURRENT),
      DECLARED,
      [...ORDER, 'ghost']
    );
    expect(
      comparison.violations.some(
        (v) => v.includes('ghost') && v.includes('未登记策略')
      )
    ).toBe(true);
  });

  it('基线自身重复条目 ⇒ 必报（不静默取第一条）', () => {
    const duplicated = baselineOf([...CURRENT, { id: 'ai', reason: '重复' }]);
    const comparison = compareCriticalModules(
      CURRENT,
      duplicated,
      DECLARED,
      ORDER
    );
    expect(
      comparison.violations.some(
        (v) => v.includes('基线里') && v.includes('重复')
      )
    ).toBe(true);
  });

  it('已登记策略但不在初始化顺序 ⇒ 必报（反向差集，与"未登记策略"对称）', () => {
    const comparison = compareCriticalModules(
      CURRENT,
      baselineOf(CURRENT),
      [...DECLARED, 'orphan'],
      ORDER
    );
    expect(
      comparison.violations.some(
        (v) =>
          v.includes('orphan') && v.includes('不在 MODULE_INITIALIZATION_ORDER')
      )
    ).toBe(true);
  });

  it('生成基线：带版本/日期，条目按 id 排序', () => {
    const baseline = baselineOf([
      { id: 'core', reason: 'x' },
      { id: 'ai', reason: 'y' },
    ]);
    expect(baseline.version).toBe(1);
    expect(baseline.recordedAt).toBe('2026-10-21');
    expect(baseline.modules.map((m) => m.id)).toEqual(['ai', 'core']);
    expect(baseline.note?.length).toBeGreaterThan(0);
  });
});
