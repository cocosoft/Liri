/**
 * U-14 阶段 1.3：`BudgetSuspendCoordinator` 的会话级快照联动。
 *
 * 覆盖：
 * ① `suspend()` 按会话冻结（无提供者 ⇒ 零行为）；
 * ② 放行成功时**先恢复、后续跑**（顺序可观测）；
 * ③ 续跑失败 ⇒ 回滚为挂起并**重拍**快照（下一次放行仍可恢复）；
 * ④ `release()` 丢弃快照（再次 suspend 会重新冻结）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  getBudgetSuspendCoordinator,
  resetBudgetSuspendForTest,
} from '../../src/query/budgetSuspend.js';
import {
  registerScopedSnapshotProvider,
  resetScopedSnapshotProvidersForTest,
} from '../../src/state/engine/sessionSnapshot.js';

beforeEach(() => {
  resetBudgetSuspendForTest();
  resetScopedSnapshotProvidersForTest();
});

afterEach(() => {
  resetBudgetSuspendForTest();
  resetScopedSnapshotProvidersForTest();
});

/** 注册一个记录调用的假提供者 */
function installFakeProvider(timeline: string[]): void {
  registerScopedSnapshotProvider({
    kind: 'fake',
    freezeSession: (sessionId) => {
      timeline.push(`freeze:${sessionId}`);
      return { capturedAt: 'v1' };
    },
    restoreSession: (sessionId, snapshot) => {
      timeline.push(
        `restore:${sessionId}:${String((snapshot as { capturedAt?: string }).capturedAt)}`
      );
    },
  });
}

describe('BudgetSuspendCoordinator × 会话快照（U-14 阶段 1.3）', () => {
  it('无提供者时挂起/放行零行为（不抛错）', async () => {
    const coordinator = getBudgetSuspendCoordinator();
    coordinator.setResumeHandler(async () => true);
    coordinator.suspend({ sessionId: 's1', chain: 'stream', reason: 'budget' });
    await expect(coordinator.onReliefApplied('boost')).resolves.toEqual({
      woken: ['s1'],
    });
  });

  it('suspend 冻结；放行成功时先恢复、后续跑', async () => {
    const timeline: string[] = [];
    installFakeProvider(timeline);
    const coordinator = getBudgetSuspendCoordinator();
    coordinator.setResumeHandler(async (sessionId) => {
      timeline.push(`handler:${sessionId}`);
      return true;
    });

    coordinator.suspend({ sessionId: 's1', chain: 'stream', reason: 'budget' });
    expect(timeline).toEqual(['freeze:s1']);

    await coordinator.onReliefApplied('boost');
    expect(timeline).toEqual(['freeze:s1', 'restore:s1:v1', 'handler:s1']);
    expect(coordinator.isSuspended('s1')).toBe(false);
  });

  it('续跑失败 ⇒ 回滚为挂起并重拍快照（下一次放行仍可恢复）', async () => {
    const timeline: string[] = [];
    installFakeProvider(timeline);
    const coordinator = getBudgetSuspendCoordinator();
    let attempt = 0;
    coordinator.setResumeHandler(async () => {
      attempt += 1;
      return attempt > 1;
    });

    coordinator.suspend({ sessionId: 's1', chain: 'taor', reason: 'guard' });
    await coordinator.onReliefApplied('boost');

    // 第一次：freeze → restore → handler(false) → 回滚后重拍
    expect(timeline).toEqual(['freeze:s1', 'restore:s1:v1', 'freeze:s1']);
    expect(coordinator.isSuspended('s1')).toBe(true);

    timeline.length = 0;
    await coordinator.onReliefApplied('boost');
    // 第二次成功 ⇒ 只恢复，不再重拍
    expect(timeline).toEqual(['restore:s1:v1']);
    expect(coordinator.isSuspended('s1')).toBe(false);
  });

  it('release 丢弃快照：再次挂起会重新冻结', () => {
    const timeline: string[] = [];
    installFakeProvider(timeline);
    const coordinator = getBudgetSuspendCoordinator();

    coordinator.suspend({ sessionId: 's1', chain: 'stream', reason: 'budget' });
    coordinator.release('s1');
    timeline.length = 0;

    // 快照已丢弃 ⇒ 此时 restore 是 no-op
    coordinator.restoreSnapshot('s1');
    expect(timeline).toEqual([]);

    coordinator.suspend({ sessionId: 's1', chain: 'stream', reason: 'budget' });
    expect(timeline).toEqual(['freeze:s1']);
  });
});
