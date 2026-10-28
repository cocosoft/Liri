/**
 * PhaseVocabulary — 阶段词汇表单一真源回归测试（架构归一 B6）
 *
 * B6：ImplicitIntent 与意图阶段（PdcaIntent）此前无映射层；toPdcaPhase() 显式转换是映射层。
 * 'none' → undefined，其余同值映射。
 */
import { describe, expect, test } from 'bun:test';
import {
  toPdcaPhase,
  pdcaCheckpointStatus,
  PDCA_TO_WORKITEM,
  PDCA_TERMINAL_PHASES,
  type PdcaPhase,
  type WorkItemStatus,
} from '@modules/tasks/phases';

describe('PhaseVocabulary B6 — toPdcaPhase 隐式意图 → 意图阶段显式转换', () => {
  test('plan/do/check/act 同值映射', () => {
    expect(toPdcaPhase('plan')).toBe('plan');
    expect(toPdcaPhase('do')).toBe('do');
    expect(toPdcaPhase('check')).toBe('check');
    expect(toPdcaPhase('act')).toBe('act');
  });

  test("'none' → undefined（无可用 PDCA 意图）", () => {
    expect(toPdcaPhase('none')).toBeUndefined();
  });
});

describe('PhaseVocabulary B4 — 编排族单一真源（pdcaCheckpointStatus / PDCA_TO_WORKITEM / PDCA_TERMINAL_PHASES）', () => {
  test('pdcaCheckpointStatus 派生 checkpoint.status', () => {
    for (const phase of [
      'plan',
      'plan_pending',
      'stage_awaiting_approval',
    ] as const) {
      expect(pdcaCheckpointStatus(phase)).toBe('started');
    }
    for (const phase of ['execute', 'review', 'decide'] as const) {
      expect(pdcaCheckpointStatus(phase)).toBe('running');
    }
    for (const phase of ['completed', 'abort', 'failed'] as const) {
      expect(pdcaCheckpointStatus(phase)).toBe('completed');
    }
  });

  test('PDCA_TO_WORKITEM 派生 WorkItem.status（与 Bridge 原映射一致）', () => {
    // 2026-10-25：迁入包内后由包 `tsconfig.tests.json` 按 **源码类型** 检查
    // （原先在 app 侧解析到 dist d.ts，`Record<PdcaPhase, string>` 的松标注才得以通过）——
    // 这里改成与真源一致的 `WorkItemStatus`，让映射表漏项/错值在编译期就红。
    const expected: Record<PdcaPhase, WorkItemStatus> = {
      plan: 'pending',
      plan_pending: 'review',
      stage_awaiting_approval: 'review',
      execute: 'running',
      review: 'review',
      decide: 'running',
      completed: 'done',
      abort: 'failed',
      failed: 'failed',
    };
    expect(PDCA_TO_WORKITEM).toEqual(expected);
  });

  test('PDCA_TERMINAL_PHASES 仅含终态', () => {
    expect(PDCA_TERMINAL_PHASES).toEqual(
      new Set(['completed', 'failed', 'abort'])
    );
  });
});
