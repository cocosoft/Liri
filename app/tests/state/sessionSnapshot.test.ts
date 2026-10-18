/**
 * U-14 阶段 1.3：会话级快照注册表（`state/engine/sessionSnapshot`）。
 *
 * 覆盖：
 * ① 无提供者 ⇒ `null`（不造空快照）；
 * ② 按 `sessionId` 冻结并按 kind 扇出恢复；
 * ③ 单提供者冻结/恢复失败**不阻断**其它提供者（CS03：只留痕）；
 * ④ 注销后不再参与；未知 kind 的旧句柄静默跳过。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  freezeSessionSnapshot,
  getScopedSnapshotProviderCount,
  registerScopedSnapshotProvider,
  resetScopedSnapshotProvidersForTest,
  restoreSessionSnapshot,
} from '../../src/state/engine/sessionSnapshot.js';

afterEach(() => {
  resetScopedSnapshotProvidersForTest();
});

describe('sessionSnapshot 注册表', () => {
  it('无提供者 ⇒ null（不造空快照）', () => {
    expect(getScopedSnapshotProviderCount()).toBe(0);
    expect(freezeSessionSnapshot('s1')).toBeNull();
  });

  it('按会话冻结，并按 kind 扇出恢复', () => {
    const calls: string[] = [];
    registerScopedSnapshotProvider({
      kind: 'a',
      freezeSession: (sid) => {
        calls.push(`freeze-a:${sid}`);
        return { handle: 'a' };
      },
      restoreSession: (sid, snapshot) => {
        calls.push(`restore-a:${sid}:${JSON.stringify(snapshot)}`);
      },
    });
    registerScopedSnapshotProvider({
      kind: 'b',
      freezeSession: (sid) => {
        calls.push(`freeze-b:${sid}`);
        return { handle: 'b' };
      },
      restoreSession: (sid, snapshot) => {
        calls.push(`restore-b:${sid}:${JSON.stringify(snapshot)}`);
      },
    });

    const snapshot = freezeSessionSnapshot('s1');
    expect(snapshot?.sessionId).toBe('s1');
    expect(Object.keys(snapshot?.handles ?? {}).sort()).toEqual(['a', 'b']);

    restoreSessionSnapshot(snapshot!);
    expect(calls).toEqual([
      'freeze-a:s1',
      'freeze-b:s1',
      'restore-a:s1:{"handle":"a"}',
      'restore-b:s1:{"handle":"b"}',
    ]);
  });

  it('单提供者冻结失败不阻断其它提供者', () => {
    registerScopedSnapshotProvider({
      kind: 'broken',
      freezeSession: () => {
        throw new Error('boom');
      },
      restoreSession: () => {
        throw new Error('should-not-run');
      },
    });
    registerScopedSnapshotProvider({
      kind: 'healthy',
      freezeSession: () => ({ ok: true }),
      restoreSession: () => {},
    });

    const snapshot = freezeSessionSnapshot('s1');
    expect(snapshot).not.toBeNull();
    expect(Object.keys(snapshot!.handles)).toEqual(['healthy']);
    // 恢复时 healthy 正常执行、broken 缺席（不抛错）
    expect(() => restoreSessionSnapshot(snapshot!)).not.toThrow();
  });

  it('恢复失败只留痕，不向调用方抛错', () => {
    registerScopedSnapshotProvider({
      kind: 'fails-on-restore',
      freezeSession: () => ({ ok: true }),
      restoreSession: () => {
        throw new Error('restore boom');
      },
    });
    const snapshot = freezeSessionSnapshot('s1');
    expect(() => restoreSessionSnapshot(snapshot!)).not.toThrow();
  });

  it('注销后不再参与；未知 kind 的旧句柄静默跳过', () => {
    const unregister = registerScopedSnapshotProvider({
      kind: 'ephemeral',
      freezeSession: () => ({ ok: true }),
      restoreSession: () => {
        throw new Error('should-not-run');
      },
    });
    const unregisterAgain = unregister;
    unregister();
    unregisterAgain(); // 幂等
    expect(getScopedSnapshotProviderCount()).toBe(0);
    expect(freezeSessionSnapshot('s1')).toBeNull();
    // 旧句柄（提供者已注销）恢复 ⇒ 静默跳过，不抛错
    expect(() =>
      restoreSessionSnapshot({ sessionId: 's1', handles: { ephemeral: {} } })
    ).not.toThrow();
  });
});
