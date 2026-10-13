/**
 * T1-2② / TG-2+TG-6（A 片）：`ISnapshotCapable` **探测契约**（2026-10-13）
 *
 * 覆盖：三要件**同时**成立才 `true`；缺一 ⇒ `false`（**不臆造**）；非对象/`null` 不抛异常；
 * 标记非字面量 `true`（如 `'yes'` / `1`）⇒ `false`；探测**不调用**任何方法（纯读、无副作用）。
 */
import { describe, it, expect } from 'bun:test';
import { isSnapshotCapable } from '../../src/utils/toolContract/Tool.js';

function makeCapable(overrides: Record<string, unknown> = {}) {
  let frozen = 0;
  let resumed = 0;
  return {
    probe: {
      snapshotCapable: true as const,
      freezeForSuspend: () => {
        frozen += 1;
        return { jobId: 'j-1' };
      },
      resumeFromSnapshot: () => {
        resumed += 1;
      },
      ...overrides,
    },
    counters: () => ({ frozen, resumed }),
  };
}

describe('T1-2② A 片：ISnapshotCapable 探测契约', () => {
  it('三要件齐备 ⇒ true，且探测本身不触发任何副作用', () => {
    const { probe, counters } = makeCapable();
    expect(isSnapshotCapable(probe)).toBe(true);
    expect(counters()).toEqual({ frozen: 0, resumed: 0 });
  });

  it('只挂标记不实现方法 ⇒ false（半成品不得被误判）', () => {
    expect(isSnapshotCapable({ snapshotCapable: true })).toBe(false);
    expect(
      isSnapshotCapable({ snapshotCapable: true, freezeForSuspend: () => ({}) })
    ).toBe(false);
  });

  it('标记非字面量 true ⇒ false（避免字符串/数字假阳性）', () => {
    const { probe } = makeCapable({ snapshotCapable: 'yes' });
    expect(isSnapshotCapable(probe)).toBe(false);
    const { probe: p2 } = makeCapable({ snapshotCapable: 1 });
    expect(isSnapshotCapable(p2)).toBe(false);
  });

  it('未声明能力（普通工具 / 类实例）⇒ false', () => {
    class PlainTool {
      name = 'bash';
      execute(): void {}
    }
    expect(isSnapshotCapable(new PlainTool())).toBe(false);
    expect(isSnapshotCapable({ name: 'bash' })).toBe(false);
  });

  it('非对象 / null / 原始值 ⇒ false 且不抛异常', () => {
    for (const v of [null, undefined, 0, '', 'tool', true, Symbol('x')]) {
      expect(() => isSnapshotCapable(v)).not.toThrow();
      expect(isSnapshotCapable(v)).toBe(false);
    }
  });
});
