/**
 * M-6/M-7 接线（2026-09-22）：批次收口 ⇒ 落定该会话**未终结目标**的状态。
 *
 * 关键性质：
 * - **零回归**：无会话归属 / 该会话无未终结目标 ⇒ `null`，**不建行、不写库**；
 * - 状态映射：全通过 ⇒ `completed`、部分成功 ⇒ `blocked`（可恢复）、全失败 ⇒ `failed`、
 *   取消 ⇒ `cancelled`（取消优先于结果）；
 * - 只取第一个未终结目标；已终结目标不受影响（终态幂等）。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import {
  TaskGoalStore,
  type TaskGoalStatus,
} from '../../../src/tasks/goal/TaskGoalStore';
import {
  deriveGoalStatus,
  settleGoalForRun,
  NO_PROGRESS_STOP_THRESHOLD,
} from '../../../src/tasks/goal/goalRunBinding';

const createdPaths: string[] = [];
const opened: TaskGoalStore[] = [];

function makeStore(): TaskGoalStore {
  const path = join(tmpdir(), `goal-binding-${randomUUID().slice(0, 8)}.db`);
  createdPaths.push(path);
  const store = new TaskGoalStore(path);
  opened.push(store);
  return store;
}

afterEach(() => {
  while (opened.length > 0) opened.pop()!.close();
  while (createdPaths.length > 0) {
    try {
      unlinkSync(createdPaths.pop()!);
    } catch {
      // @ignore-catch — 清理临时文件失败不影响断言
    }
  }
});

describe('deriveGoalStatus：批次结果 → 目标状态', () => {
  test('映射表（取消优先于结果）', () => {
    expect(
      deriveGoalStatus({ allPassed: true, okCount: 3, cancelled: false })
    ).toBe('completed');
    expect(
      deriveGoalStatus({ allPassed: false, okCount: 1, cancelled: false })
    ).toBe('blocked');
    expect(
      deriveGoalStatus({ allPassed: false, okCount: 0, cancelled: false })
    ).toBe('failed');
    expect(
      deriveGoalStatus({ allPassed: true, okCount: 3, cancelled: true })
    ).toBe('cancelled');
  });
});

describe('settleGoalForRun：接线与零回归', () => {
  test('无会话归属 ⇒ null（不建行）', async () => {
    const store = makeStore();
    const r = await settleGoalForRun({
      outcome: { allPassed: true, okCount: 1, cancelled: false },
      store,
    });
    expect(r).toBeNull();
  });

  test('该会话无未终结目标 ⇒ null，且**不新建行**（零回归）', async () => {
    const store = makeStore();
    const r = await settleGoalForRun({
      sessionId: 'sess-none',
      outcome: { allPassed: true, okCount: 1, cancelled: false },
      store,
    });
    expect(r).toBeNull();
    expect(await store.listBySession('sess-none')).toHaveLength(0);
  });

  test('全通过 ⇒ 目标落 completed', async () => {
    const store = makeStore();
    const goal = await store.create({
      objective: '达成 A',
      sessionId: 'sess-ok',
    });

    const r = await settleGoalForRun({
      sessionId: 'sess-ok',
      outcome: { allPassed: true, okCount: 2, cancelled: false },
      store,
    });

    expect(r).toEqual({ goalId: goal.id, status: 'completed' });
    expect((await store.get(goal.id))?.status).toBe('completed');
  });

  test('部分成功 ⇒ 落 blocked（非终态 ⇒ 可继续推进为 completed）', async () => {
    const store = makeStore();
    const goal = await store.create({
      objective: '达成 B',
      sessionId: 'sess-partial',
    });

    const r = await settleGoalForRun({
      sessionId: 'sess-partial',
      outcome: { allPassed: false, okCount: 1, cancelled: false },
      store,
    });
    expect(r?.status).toBe('blocked');
    expect((await store.get(goal.id))?.status).toBe('blocked');

    // blocked 是可恢复状态：后续批次全通过即可完成
    const r2 = await settleGoalForRun({
      sessionId: 'sess-partial',
      outcome: { allPassed: true, okCount: 2, cancelled: false },
      store,
    });
    expect(r2?.status).toBe('completed');
  });

  test('全失败 ⇒ failed；批次取消 ⇒ cancelled', async () => {
    const store = makeStore();
    const failed = await store.create({
      objective: '达成 C',
      sessionId: 'sess-fail',
    });
    expect(
      (
        await settleGoalForRun({
          sessionId: 'sess-fail',
          outcome: { allPassed: false, okCount: 0, cancelled: false },
          store,
        })
      )?.status
    ).toBe('failed');
    expect((await store.get(failed.id))?.status).toBe('failed');

    const cancelledGoal = await store.create({
      objective: '达成 D',
      sessionId: 'sess-cancel',
    });
    expect(
      (
        await settleGoalForRun({
          sessionId: 'sess-cancel',
          outcome: { allPassed: true, okCount: 1, cancelled: true },
          store,
        })
      )?.status
    ).toBe('cancelled');
    expect((await store.get(cancelledGoal.id))?.status).toBe('cancelled');
  });

  test('已终结目标 ⇒ null 且状态不变（终态幂等 / 不漏报）', async () => {
    const store = makeStore();
    const goal = await store.create({
      objective: '已完成的',
      sessionId: 'sess-done',
    });
    await store.updateStatus(goal.id, 'completed' as TaskGoalStatus);

    const r = await settleGoalForRun({
      sessionId: 'sess-done',
      outcome: { allPassed: true, okCount: 1, cancelled: false },
      store,
    });
    expect(r).toBeNull();
    expect((await store.get(goal.id))?.status).toBe('completed');
  });

  test('多个未终结目标 ⇒ 只落**第一个**（按创建时间升序）', async () => {
    const store = makeStore();
    const first = await store.create({
      objective: '第一个',
      sessionId: 'sess-multi',
      now: 1000,
    });
    const second = await store.create({
      objective: '第二个',
      sessionId: 'sess-multi',
      now: 2000,
    });

    const r = await settleGoalForRun({
      sessionId: 'sess-multi',
      outcome: { allPassed: true, okCount: 1, cancelled: false },
      store,
    });
    expect(r?.goalId).toBe(first.id);
    expect((await store.get(second.id))?.status).toBe('active');
  });
});

/**
 * M-8 接线（2026-09-22）：批次真实用量 ⇒ 目标记账 ⇒ 触顶落 `budget_limited` + 收尾指令。
 */
describe('settleGoalForRun：用量记账与预算触顶', () => {
  test('未触顶 ⇒ 记账累加，状态仍按批次结果落定', async () => {
    const store = makeStore();
    const goal = await store.create({
      objective: '预算内',
      sessionId: 'sess-charge-ok',
      tokenBudget: 1000,
    });

    const r = await settleGoalForRun({
      sessionId: 'sess-charge-ok',
      outcome: { allPassed: true, okCount: 2, cancelled: false },
      tokens: 300,
      store,
    });

    expect(r).toEqual({ goalId: goal.id, status: 'completed' });
    expect((await store.get(goal.id))?.tokensUsed).toBe(300);
  });

  test('触顶 ⇒ 落 `budget_limited` 并给出收尾指令（优先于批次结果）', async () => {
    const store = makeStore();
    const goal = await store.create({
      objective: '会触顶',
      sessionId: 'sess-charge-over',
      tokenBudget: 100,
    });

    const r = await settleGoalForRun({
      // 即便批次"全通过"，触顶也是更高优先的结论
      sessionId: 'sess-charge-over',
      outcome: { allPassed: true, okCount: 1, cancelled: false },
      tokens: 150,
      store,
    });

    expect(r?.status).toBe('budget_limited');
    expect(r?.closingInstruction).toContain('(150/100)');
    expect((await store.get(goal.id))?.status).toBe('budget_limited');
  });

  test('未提供用量 ⇒ 不记账（`tokensUsed` 保持 0，不臆测）', async () => {
    const store = makeStore();
    const goal = await store.create({
      objective: '无用量',
      sessionId: 'sess-charge-none',
      tokenBudget: 1,
    });

    const r = await settleGoalForRun({
      sessionId: 'sess-charge-none',
      outcome: { allPassed: true, okCount: 1, cancelled: false },
      store,
    });

    expect(r?.status).toBe('completed');
    expect((await store.get(goal.id))?.tokensUsed).toBe(0);
  });

  test('取消 + 触顶 ⇒ 触顶优先（`budget_limited`）', async () => {
    const store = makeStore();
    const goal = await store.create({
      objective: '取消且触顶',
      sessionId: 'sess-charge-cancel',
      tokenBudget: 50,
    });

    const r = await settleGoalForRun({
      sessionId: 'sess-charge-cancel',
      outcome: { allPassed: false, okCount: 0, cancelled: true },
      tokens: 60,
      store,
    });

    expect(r?.status).toBe('budget_limited');
    expect((await store.get(goal.id))?.status).toBe('budget_limited');
  });
});

/**
 * **停止条件**（2026-09-22）：连续"部分成功"（`blocked`）达 `NO_PROGRESS_STOP_THRESHOLD`
 * ⇒ 不再停留非终态（否则会被 `listActive` 反复选中续推、不收敛），落终态 `failed`
 * 并给出 `progress_stalled` 指令 —— "为何停下"因此有唯一答案。
 *
 * 修复前：`blocked` 会一直累积（非终态），无任何"停下来"的判据。
 */
describe('settleGoalForRun：连续无进展停止条件', () => {
  const blocked = { allPassed: false, okCount: 1, cancelled: false };

  test('未达阈值 ⇒ 保持 blocked 并累计 streak（不提前停止）', async () => {
    const store = makeStore();
    const goal = await store.create({
      objective: '慢目标',
      sessionId: 'sess-stall-under',
    });

    for (let i = 1; i < NO_PROGRESS_STOP_THRESHOLD; i++) {
      const r = await settleGoalForRun({
        sessionId: 'sess-stall-under',
        outcome: blocked,
        store,
      });
      expect(r?.status).toBe('blocked');
      expect(r?.noProgressStreak).toBe(i);
      expect(r?.stopInstruction).toBeUndefined();
    }

    const after = await store.get(goal.id);
    expect(after?.status).toBe('blocked');
    expect(after?.noProgressStreak).toBe(NO_PROGRESS_STOP_THRESHOLD - 1);
  });

  test('达阈值 ⇒ 落 failed + progress_stalled 指令（含 streak 与 objective）', async () => {
    const store = makeStore();
    const goal = await store.create({
      objective: '反复受阻的目标',
      sessionId: 'sess-stall-hit',
    });

    let last: Awaited<ReturnType<typeof settleGoalForRun>> = null;
    for (let i = 0; i < NO_PROGRESS_STOP_THRESHOLD; i++) {
      last = await settleGoalForRun({
        sessionId: 'sess-stall-hit',
        outcome: blocked,
        store,
      });
    }

    // 修复前：此处恒为 `blocked`（非终态），目标永不收敛
    expect(last?.status).toBe('failed');
    expect(last?.noProgressStreak).toBe(NO_PROGRESS_STOP_THRESHOLD);
    expect(last?.stopInstruction).toContain(
      `no progress for ${NO_PROGRESS_STOP_THRESHOLD} consecutive batches`
    );
    expect(last?.stopInstruction).toContain('反复受阻的目标');
    expect((await store.get(goal.id))?.status).toBe('failed');
  });

  test('落终态后再次收口 ⇒ null（终态不可改写，streak 不再增长）', async () => {
    const store = makeStore();
    const goal = await store.create({
      objective: '已停止',
      sessionId: 'sess-stall-after',
    });

    for (let i = 0; i < NO_PROGRESS_STOP_THRESHOLD; i++) {
      await settleGoalForRun({
        sessionId: 'sess-stall-after',
        outcome: blocked,
        store,
      });
    }

    const again = await settleGoalForRun({
      sessionId: 'sess-stall-after',
      outcome: blocked,
      store,
    });
    expect(again).toBeNull();
    const after = await store.get(goal.id);
    expect(after?.status).toBe('failed');
    expect(after?.noProgressStreak).toBe(NO_PROGRESS_STOP_THRESHOLD);
  });

  test('全通过（达成）不计数 ⇒ streak 保持 0', async () => {
    const store = makeStore();
    const goal = await store.create({
      objective: '一次过',
      sessionId: 'sess-stall-done',
    });

    const r = await settleGoalForRun({
      sessionId: 'sess-stall-done',
      outcome: { allPassed: true, okCount: 2, cancelled: false },
      store,
    });

    expect(r?.status).toBe('completed');
    expect(r?.noProgressStreak).toBeUndefined();
    expect((await store.get(goal.id))?.noProgressStreak).toBe(0);
  });

  test('预算触顶优先于停止条件 ⇒ budget_limited，且不给停止指令', async () => {
    const store = makeStore();
    await store.create({
      objective: '既受阻又超预算',
      sessionId: 'sess-stall-budget',
      tokenBudget: 100,
    });

    const r = await settleGoalForRun({
      sessionId: 'sess-stall-budget',
      outcome: blocked,
      tokens: 150,
      store,
    });

    expect(r?.status).toBe('budget_limited');
    expect(r?.closingInstruction).toContain('(150/100)');
    expect(r?.stopInstruction).toBeUndefined();
    expect(r?.noProgressStreak).toBeUndefined();
  });
});
