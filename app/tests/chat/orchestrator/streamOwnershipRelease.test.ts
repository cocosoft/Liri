/**
 * P2-1e —— S2/S7 **所有权释放**契约测试（2026-10-10）。
 *
 * 依据：`.trae/specs/stream-message-flow-split.md` §3-S2 与 §3-S7 / §5；实现见
 * `src/chat/orchestrator/streamMessageOwnership.ts`。
 *
 * 锁定「只释放**确实持有**的」这条既有修复的硬口径：
 * `mutexHeld === false` ⇒ **绝不** `mutex.release()`（否则会错误清零**他人**持有的锁，
 * 致并发请求穿透「同一会话串行」保证）。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import { getResourceGovernor } from '@modules/resourceGovernor';
import { releaseStreamOwnership } from '../../../src/chat/orchestrator/streamMessageOwnership.js';

/** 临时替换单例的 `release` 以观测调用（测后恢复） */
const gov = getResourceGovernor() as unknown as {
  release: (sessionId: string) => void;
};
const originalRelease = gov.release;

afterEach(() => {
  gov.release = originalRelease;
});

function withGovernorSpy(): { seen: string[] } {
  const seen: string[] = [];
  gov.release = (sessionId: string) => {
    seen.push(sessionId);
  };
  return { seen };
}

/** mutex 桩：统计 `release` 调用次数 */
function mutexSpy(): { mutex: { release: () => void }; count: () => number } {
  let n = 0;
  return {
    mutex: {
      release: () => {
        n++;
      },
    },
    count: () => n,
  };
}

describe('P2-1e S2/S7 · 所有权释放', () => {
  it('两者皆持有 ⇒ mutex 释放一次 + 治理器按会话释放一次', () => {
    const { seen } = withGovernorSpy();
    const { mutex, count } = mutexSpy();

    releaseStreamOwnership(mutex, 's-1', true, true);

    expect(count()).toBe(1);
    expect(seen).toEqual(['s-1']);
  });

  it('`mutexHeld=false` ⇒ **绝不**释放 mutex（但治理器名额仍释放）', () => {
    const { seen } = withGovernorSpy();
    const { mutex, count } = mutexSpy();

    releaseStreamOwnership(mutex, 's-2', false, true);

    expect(count()).toBe(0);
    expect(seen).toEqual(['s-2']);
  });

  it('`governorAdmitted=false` ⇒ 不释放治理器名额（mutex 仍释放）', () => {
    const { seen } = withGovernorSpy();
    const { mutex, count } = mutexSpy();

    releaseStreamOwnership(mutex, 's-3', true, false);

    expect(count()).toBe(1);
    expect(seen).toEqual([]);
  });

  it('两者皆未持有（acquire 抛错路径）⇒ 不释放任何（防错误清零他人锁/名额）', () => {
    const { seen } = withGovernorSpy();
    const { mutex, count } = mutexSpy();

    releaseStreamOwnership(mutex, 's-4', false, false);

    expect(count()).toBe(0);
    expect(seen).toEqual([]);
  });
});
