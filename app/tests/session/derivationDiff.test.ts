/**
 * P2-7 / G4（2026-09-25）：派生一致性校验的**比对语义**（纯函数 `diffDerivationMessages`）。
 *
 * 覆盖 spec §7「一致性校验」：一致 ⇒ `mismatch=false`；仅事件有 / 仅投影有 ⇒ `mismatch=true` 且分列；
 * `lastEventSeq` 取两侧最大值；空输入 ⇒ `null`（不误报）。
 *
 * **覆盖边界（如实）**：`CoreAPI.verifySessionDerivation()` 的**取数 + 接线**未做集成测试
 * （`CoreAPIImpl` 为单例、依赖面大，仓内无 `getCoreAPI()` 测试先例）⇒ 本文件只锁比对语义，
 * 取数侧由 `typecheck` 与既有派生读路径回归（`tests/session`、`tests/chat`）守护。
 */
import { describe, test, expect } from 'bun:test';
import { diffDerivationMessages } from '../../src/session/storage/EventMessageDeriver';

describe('diffDerivationMessages（G4 比对语义）', () => {
  test('两侧一致 ⇒ mismatch=false 且差集为空、seq 一致', () => {
    const d = diffDerivationMessages(
      [
        { id: 'a', lastEventSeq: 3 },
        { id: 'b', lastEventSeq: 7 },
      ],
      [
        { id: 'a', lastEventSeq: 3 },
        { id: 'b', lastEventSeq: 7 },
      ]
    );

    expect(d.mismatch).toBe(false);
    expect(d.derivedCount).toBe(2);
    expect(d.projectedCount).toBe(2);
    expect(d.onlyInEvents).toEqual([]);
    expect(d.onlyInProjections).toEqual([]);
    expect(d.lastDerivedSeq).toBe(7);
    expect(d.lastProjectedSeq).toBe(7);
  });

  test('事件有、投影无 ⇒ onlyInEvents（候选"未落盘"）', () => {
    const d = diffDerivationMessages(
      [
        { id: 'a', lastEventSeq: 1 },
        { id: 'b', lastEventSeq: 9 },
      ],
      [{ id: 'a', lastEventSeq: 1 }]
    );

    expect(d.mismatch).toBe(true);
    expect(d.onlyInEvents).toEqual(['b']);
    expect(d.onlyInProjections).toEqual([]);
    expect(d.lastDerivedSeq).toBe(9);
    expect(d.lastProjectedSeq).toBe(1);
  });

  test('投影有、事件无 ⇒ onlyInProjections（候选"投影残留/孤儿"）', () => {
    const d = diffDerivationMessages(
      [{ id: 'a', lastEventSeq: 2 }],
      [
        { id: 'a', lastEventSeq: 2 },
        { id: 'z', lastEventSeq: 4 },
      ]
    );

    expect(d.mismatch).toBe(true);
    expect(d.onlyInProjections).toEqual(['z']);
    expect(d.onlyInEvents).toEqual([]);
    expect(d.lastProjectedSeq).toBe(4);
  });

  test('两侧皆空 ⇒ 计数 0、seq 为 null、不误报 mismatch', () => {
    const d = diffDerivationMessages([], []);

    expect(d.derivedCount).toBe(0);
    expect(d.projectedCount).toBe(0);
    expect(d.lastDerivedSeq).toBeNull();
    expect(d.lastProjectedSeq).toBeNull();
    expect(d.mismatch).toBe(false);
  });

  test('缺 lastEventSeq 记 0（取最大值口径，不抛错）', () => {
    const d = diffDerivationMessages(
      [{ id: 'a' }, { id: 'b', lastEventSeq: 5 }],
      []
    );

    expect(d.lastDerivedSeq).toBe(5);
  });
});
