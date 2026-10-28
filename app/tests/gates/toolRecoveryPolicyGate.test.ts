/**
 * AC-11「不可逆操作 100% 非 retryable」门禁（P5-1，2026-10-28）
 *
 * ## 判据从哪来
 * 方案 AC-11：`planned/dispatched/confirmed` 三态 + **不可逆操作必须有幂等键，否则不得 `retryable`**。
 * 本仓在**工具层**已有该语义的单一事实源：`tools/toolEffects.ts` 的 `TOOL_EFFECTS`
 * （`Record<ToolName, …>`，漏声明即 typecheck 失败）+ `resolveToolRecoveryPolicy()`：
 * 只有 `idempotent === true` 才返回 `retryable`，**未声明（MCP / 插件）一律 `manual`**。
 *
 * 因此 P5 的"审计并覆盖 100% 不可逆操作"在本层可**直接判定**：
 * > 任一 `sideEffect !== 'none'`（本地/外部可见影响）的工具，都**不得**声明 `idempotent: true`。
 * > 若将来某个工具确实要重放（真幂等写），它必须同时提供**幂等键**机制 —— 那是一次显式评审，
 * > 不能靠改一行 `idempotent: true` 悄悄发生。
 *
 * 实测（2026-10-28）：82 条声明中 **54** 条有副作用，其中 `idempotent: true` 的 **0** 条 ⇒ AC-11 成立。
 * 本门禁把这个"0"钉死，并对"未声明 ⇒ 不可重放"的 fail-closed 行为做负向自证。
 */
import { describe, expect, it } from 'bun:test';

import { TOOL_NAMES_COUNT } from '../../src/constants/toolNames.generated';
import {
  TOOL_EFFECTS,
  canReplayAfterUnknown,
  resolveToolEffect,
  resolveToolRecoveryPolicy,
  shouldBlindRetryTool,
  type ToolEffect,
} from '../../src/tools/toolEffects';

/** 纯函数：找出"有副作用却被声明为可重放"的工具（AC-11 违规集合） */
function findRetryableIrreversible(
  effects: Readonly<Record<string, ToolEffect>>
): string[] {
  return Object.entries(effects)
    .filter(([, e]) => e.sideEffect !== 'none' && e.idempotent)
    .map(([name]) => name)
    .sort();
}

/** 纯函数：统计有副作用的工具数（供"覆盖 100%"的可读报告） */
function countSideEffectful(
  effects: Readonly<Record<string, ToolEffect>>
): number {
  return Object.values(effects).filter((e) => e.sideEffect !== 'none').length;
}

describe('AC-11 · 不可逆操作不得 retryable', () => {
  it('全部已声明工具中，有副作用却"可重放"的 **必须为 0**', () => {
    // 防空转：声明面必须非空且确实存在有副作用的工具
    expect(Object.keys(TOOL_EFFECTS).length).toBeGreaterThan(0);
    expect(countSideEffectful(TOOL_EFFECTS)).toBeGreaterThan(0);

    expect(findRetryableIrreversible(TOOL_EFFECTS)).toEqual([]);
  });

  it('覆盖 100%：每个可实例化内置工具都有 effects 声明（不多不少）', () => {
    expect(Object.keys(TOOL_EFFECTS).length).toBe(TOOL_NAMES_COUNT);
  });

  it('有副作用 ⇒ 恢复策略为 `manual`（不自动重放）', () => {
    for (const [name, effect] of Object.entries(TOOL_EFFECTS)) {
      if (effect.sideEffect === 'none') continue;
      expect(resolveToolRecoveryPolicy(name)).toBe('manual');
      expect(canReplayAfterUnknown(name)).toBe(false);
      expect(shouldBlindRetryTool(name)).toBe(false);
    }
  });

  it('未声明工具（MCP / 插件）⇒ fail-closed：不可重放', () => {
    const unknown = 'acme__create_issue';
    expect(resolveToolEffect(unknown)).toBeUndefined();
    expect(resolveToolRecoveryPolicy(unknown)).toBe('manual');
    expect(canReplayAfterUnknown(unknown)).toBe(false);
    expect(shouldBlindRetryTool(unknown)).toBe(false);
  });

  it('门禁自证（负向夹具）：有副作用 + 幂等 ⇒ 必报', () => {
    const fixture: Record<string, ToolEffect> = {
      file_read: { idempotent: true, sideEffect: 'none' },
      file_write: { idempotent: false, sideEffect: 'local' },
      // 违规样本：远端写被声明成"可重放"（真实缺陷形态：重复调用会重复扣款/重复发消息）
      pay_invoice: { idempotent: true, sideEffect: 'external' },
    };
    expect(findRetryableIrreversible(fixture)).toEqual(['pay_invoice']);
    expect(countSideEffectful(fixture)).toBe(2);
  });
});
