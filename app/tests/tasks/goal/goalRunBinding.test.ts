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
import type { LiriEvent } from '../../../src/chat/types/events';
import type { LiriEventMap } from '../../../src/chat/types/eventPayloads';
import {
  TaskGoalStore,
  type TaskGoalStatus,
} from '../../../src/tasks/goal/TaskGoalStore';
import {
  deriveGoalStatus,
  settleGoalForRun,
  settleGoalForTurn,
  NO_PROGRESS_STOP_THRESHOLD,
} from '../../../src/tasks/goal/goalRunBinding';
import { chargeGoalUsage } from '../../../src/tasks/goal/goalBudget';
import { renderGoalTemplate } from '../../../src/tasks/goal/goalTemplates';
import { setGoalEventSink } from '../../../src/tasks/goal/GoalEvents';
import {
  parseIdleContinueTaskId,
  resolveIdleContinuation,
  setIdleContinuationSchedulerForTest,
} from '../../../src/tasks/goal/goalIdleContinuation';
import {
  recentPhases,
  resetPhaseStack,
} from '../../../src/diagnostics/loopProbe/phaseStack';

const createdPaths: string[] = [];
const opened: TaskGoalStore[] = [];

function makeStore(): TaskGoalStore {
  const path = join(tmpdir(), `goal-binding-${randomUUID().slice(0, 8)}.db`);
  createdPaths.push(path);
  const store = new TaskGoalStore(path);
  opened.push(store);
  return store;
}

/** 内存追加器（只模拟 seq 分配；与 `goalEvents.test.ts` 同法） */
function makeSink(): LiriEvent[] {
  const written: LiriEvent[] = [];
  let tail = 0;
  setGoalEventSink(async (_sessionId, event) => {
    tail += 1;
    written.push({ ...event, seq: tail } as LiriEvent);
    return { ok: true, tailSeq: tail };
  });
  return written;
}

/** 记录"被登记的空闲续接"（不真的调度） */
function makeScheduler(): string[] {
  const taskIds: string[] = [];
  setIdleContinuationSchedulerForTest({
    sleepFor: async (_sessionId, taskId) => {
      taskIds.push(taskId);
      return undefined;
    },
  });
  return taskIds;
}

afterEach(() => {
  setGoalEventSink(null);
  setIdleContinuationSchedulerForTest(undefined);
  resetPhaseStack();
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

/**
 * **V10（Spec §6 / X6）**：`Goal ↔ agent_runs` 关联 —— 批次行 id 落 `task_goals.run_id`，
 * 且反查可读回；同批次重复收口**不产第二条** `goal/updated`。
 *
 * 「修复前必失败」：`run_id` 列与 `runId` 入参此前都不存在（Spec §2.4 X6）。
 */
describe('settleGoalForRun：批次关联（V10 / X6）', () => {
  test('带 runId 收口 ⇒ run_id 落值可反查；重复同 runId 不重复落事件', async () => {
    const store = makeStore();
    const events = makeSink();
    const goal = await store.create({
      objective: '归属批次',
      sessionId: 'sess-runid',
    });

    const r = await settleGoalForRun({
      sessionId: 'sess-runid',
      outcome: { allPassed: false, okCount: 1, cancelled: false },
      runId: 'run-batch-1',
      store,
    });
    expect(r?.status).toBe('blocked');
    const after = await store.get(goal.id);
    expect(after?.runId).toBe('run-batch-1'); // ← 可反查（修复前该列不存在）

    const updated = events.filter((e) => e.type === 'goal/updated');
    expect(updated).toHaveLength(1);
    expect((updated[0].data as LiriEventMap['goal/updated']).changes).toEqual({
      runId: 'run-batch-1',
    });

    // 同一批次重复收口（同 runId）⇒ 不产第二条 goal/updated
    await settleGoalForRun({
      sessionId: 'sess-runid',
      outcome: { allPassed: false, okCount: 1, cancelled: false },
      runId: 'run-batch-1',
      store,
    });
    expect(events.filter((e) => e.type === 'goal/updated')).toHaveLength(1);
  });

  test('未提供 runId ⇒ 不写 run_id、不产 goal/updated（不臆造关联键）', async () => {
    const store = makeStore();
    const events = makeSink();
    const goal = await store.create({
      objective: '无批次',
      sessionId: 'sess-norun',
    });
    await settleGoalForRun({
      sessionId: 'sess-norun',
      outcome: { allPassed: true, okCount: 1, cancelled: false },
      store,
    });
    expect((await store.get(goal.id))?.runId).toBeUndefined();
    expect(events.filter((e) => e.type === 'goal/updated')).toHaveLength(0);
  });
});

/**
 * **V6（并发终态优先级）+ 收尾去重（§5.5④）**。
 *
 * 并发 `chargeGoalUsage`（触顶）与 `markStatusChanged('blocked')` 同目标 ⇒
 * 终态优先级必须让 **`budget_limited`** 胜出（两种交错都成立）：
 * - 若 `blocked` 先落：晋升条件为"非终态且触顶"⇒ 仍可晋升（`blocked → budget_limited` 合法）；
 * - 若 `budget_limited` 先落：`blocked` 被终态守卫拒绝。
 */
describe('预算触顶 vs 受阻：终态优先级与收尾去重（V6 / §5.5④）', () => {
  test('并发下 budget_limited 恒胜出（两种交错都成立）', async () => {
    const store = makeStore();
    const goal = await store.create({
      objective: '并发优先级',
      sessionId: 'sess-prio',
      tokenBudget: 50,
    });

    await Promise.all([
      chargeGoalUsage({ goalId: goal.id, tokens: 80, store }),
      store.markStatusChanged(goal.id, 'blocked', 'batch_blocked'),
    ]);

    expect((await store.get(goal.id))?.status).toBe('budget_limited');
    expect((await store.get(goal.id))?.updatedReason).toBe('budget_limit');
  });

  test('收尾提示只报一次：触顶后的下一批次 ⇒ 已无未终结目标（settlement 为 null）', async () => {
    const store = makeStore();
    await store.create({
      objective: '只报一次',
      sessionId: 'sess-once',
      tokenBudget: 100,
    });

    const first = await settleGoalForRun({
      sessionId: 'sess-once',
      outcome: { allPassed: true, okCount: 1, cancelled: false },
      tokens: 150,
      store,
    });
    expect(first?.status).toBe('budget_limited');
    expect(first?.closingInstruction).toBe(
      renderGoalTemplate('budget_limit', { tokensUsed: 150, tokenBudget: 100 })
    );

    // 第二次批次收口：目标已终态 ⇒ `listActive` 不含它 ⇒ null（无第二条指令可注入）
    const second = await settleGoalForRun({
      sessionId: 'sess-once',
      outcome: { allPassed: true, okCount: 1, cancelled: false },
      tokens: 50,
      store,
    });
    expect(second).toBeNull();
  });

  test('已触顶目标再记账 ⇒ 收尾指令仍在（调用方可取用），但 statusChanged=false', async () => {
    const store = makeStore();
    const goal = await store.create({
      objective: '幂等收尾',
      sessionId: 'sess-once-2',
      tokenBudget: 10,
    });
    const first = await chargeGoalUsage({ goalId: goal.id, tokens: 20, store });
    expect(first?.statusChanged).toBe(true);

    const second = await chargeGoalUsage({ goalId: goal.id, tokens: 1, store });
    expect(second?.exceeded).toBe(true);
    expect(second?.statusChanged).toBe(false); // ← 幂等判据（是否重复收尾的唯一依据）
    expect(second?.closingInstruction).toContain('(21/10)');
  });
});

/**
 * **V12 / P1-4（Spec §6 / §5.6 / D7）**：轮级收口 —— 压缩停滞 / 熔断**落 Goal**，
 * 且**连续 3 次 ⇒ 终态 `failed` ⇒ 续接有界**。
 *
 * 「修复前必失败」：`settleGoalForTurn` 与此前的 P1-4 联动**都不存在**
 *（`ReActToolLoop` 只"暂停本轮续接"，目标层无任何写入 —— Spec §2.4 X9/X10）。
 */
describe('settleGoalForTurn：轮级收口与续接有界（V12 / P1-4 / D7）', () => {
  test('sparse：无未终结目标 ⇒ null（零回归，不建行）', async () => {
    const store = makeStore();
    const r = await settleGoalForTurn({
      sessionId: 'sess-none-turn',
      reason: 'compaction_stalled',
      store,
    });
    expect(r).toBeNull();
    expect(await store.listBySession('sess-none-turn')).toHaveLength(0);
  });

  test('压缩停滞 1~2 次 ⇒ blocked + updated_reason=compaction_stalled + 登记续接', async () => {
    const store = makeStore();
    const events = makeSink();
    const taskIds = makeScheduler();
    const goal = await store.create({
      objective: '压缩压不动',
      sessionId: 'sess-stall-turn',
    });

    for (let i = 1; i < NO_PROGRESS_STOP_THRESHOLD; i++) {
      const r = await settleGoalForTurn({
        sessionId: 'sess-stall-turn',
        reason: 'compaction_stalled',
        store,
      });
      expect(r?.status).toBe('blocked');
      expect(r?.noProgressStreak).toBe(i);
      expect(r?.stopInstruction).toBeUndefined();
    }

    const after = await store.get(goal.id);
    expect(after?.status).toBe('blocked');
    expect(after?.updatedReason).toBe('compaction_stalled');
    // 未达阈值 ⇒ 每次都登记了续接（有界：最多阈值-1 次）
    expect(taskIds).toHaveLength(NO_PROGRESS_STOP_THRESHOLD - 1);
    expect(parseIdleContinueTaskId(taskIds[0])?.goalId).toBe(goal.id);
    // 事件面："为何停下"由 reason 重建；**同态**（`blocked → blocked`，第 2 次）不迁状态
    // ⇒ 不产事件（与批次级同口径：状态机拒绝同态自迁移，"不谎报迁移"）
    const reasons = events
      .filter((e) => e.type === 'goal/status_changed')
      .map((e) => (e.data as LiriEventMap['goal/status_changed']).reason);
    expect(reasons).toEqual(['compaction_stalled']);
  });

  test('**连续 3 次 ⇒ 终态 failed，且历史续接唤醒全部作废（续接有界）**', async () => {
    const store = makeStore();
    const taskIds = makeScheduler();
    const goal = await store.create({
      objective: '压不动到底',
      sessionId: 'sess-stall-cap',
    });

    let last: Awaited<ReturnType<typeof settleGoalForTurn>> = null;
    for (let i = 0; i < NO_PROGRESS_STOP_THRESHOLD; i++) {
      last = await settleGoalForTurn({
        sessionId: 'sess-stall-cap',
        reason: 'compaction_stalled',
        store,
      });
    }

    // 达阈值 ⇒ 终态（第 3 次不再登记续接 ⇒ 续接次数有上界）
    expect(last?.status).toBe('failed');
    expect(last?.noProgressStreak).toBe(NO_PROGRESS_STOP_THRESHOLD);
    expect(last?.stopInstruction).toContain(
      `no progress for ${NO_PROGRESS_STOP_THRESHOLD} consecutive batches`
    );
    expect((await store.get(goal.id))?.status).toBe('failed');
    expect((await store.get(goal.id))?.updatedReason).toBe(
      'compaction_stalled'
    );
    expect(taskIds).toHaveLength(NO_PROGRESS_STOP_THRESHOLD - 1);

    // **有界性的关键断言**：历史登记的每一次唤醒，此刻都已被闸门拒绝
    //（`resolveIdleContinuation` 要求"仍 blocked"）⇒ 不会再触发续跑（无死循环）
    for (const taskId of taskIds) {
      expect(await resolveIdleContinuation({ taskId, store })).toBeNull();
    }
    // 第 4 次收口 ⇒ 终态幂等：不再计数、不再登记
    const again = await settleGoalForTurn({
      sessionId: 'sess-stall-cap',
      reason: 'compaction_stalled',
      store,
    });
    expect(again).toBeNull();
    expect(taskIds).toHaveLength(NO_PROGRESS_STOP_THRESHOLD - 1);
  });

  test('二期 N2：只记录类原因（user_aborted）⇒ 不改状态、不计无进展、不登记续接，但原因可见', async () => {
    const store = makeStore();
    const taskIds = makeScheduler();
    const goal = await store.create({
      objective: '用户喊停',
      sessionId: 'sess-n2-abort',
    });

    const r = await settleGoalForTurn({
      sessionId: 'sess-n2-abort',
      reason: 'user_aborted',
      store,
    });

    // 无状态迁移 ⇒ 不返回 settlement（不谎报 `blocked`/`failed`）
    expect(r).toBeNull();
    const after = await store.get(goal.id);
    expect(after?.status).toBe(goal.status); // 状态不变
    expect(after?.noProgressStreak).toBe(0); // 不推进无进展计数
    expect(after?.updatedReason).toBe('user_aborted'); // 可见性：原因已记录
    // 关键：**用户主动停止不得触发 idle 续接**（否则与用户意图相反）
    expect(taskIds).toHaveLength(0);
  });

  test('二期 N2：连续 3+ 次只记录类原因（超时）也不落终态（与无进展计数解耦）', async () => {
    const store = makeStore();
    const taskIds = makeScheduler();
    const goal = await store.create({
      objective: '反复超时',
      sessionId: 'sess-n2-timeout',
    });

    for (let i = 0; i < NO_PROGRESS_STOP_THRESHOLD + 1; i++) {
      const r = await settleGoalForTurn({
        sessionId: 'sess-n2-timeout',
        reason: 'turn_timeout',
        store,
      });
      expect(r).toBeNull();
    }

    const after = await store.get(goal.id);
    expect(after?.status).toBe(goal.status); // 仍非终态
    expect(after?.noProgressStreak).toBe(0); // 无进展计数始终为 0
    expect(after?.updatedReason).toBe('turn_timeout');
    expect(taskIds).toHaveLength(0); // 不登记续接
  });

  test('轮级熔断（turn_error）与批次级**共用同一连续计数**（阈值同源，D7）', async () => {
    const store = makeStore();
    const taskIds = makeScheduler();
    const goal = await store.create({
      objective: '混合受阻',
      sessionId: 'sess-turn-mix',
    });

    await settleGoalForTurn({
      sessionId: 'sess-turn-mix',
      reason: 'turn_error',
      store,
    });
    const second = await settleGoalForTurn({
      sessionId: 'sess-turn-mix',
      reason: 'turn_error',
      store,
    });
    expect(second?.noProgressStreak).toBe(2);
    expect(second?.status).toBe('blocked');
    expect(taskIds).toHaveLength(2);

    const third = await settleGoalForTurn({
      sessionId: 'sess-turn-mix',
      reason: 'turn_error',
      store,
    });
    expect(third?.status).toBe('failed');
    expect((await store.get(goal.id))?.updatedReason).toBe('turn_error');
  });
});

/**
 * **X7（Spec §5.4 / U5）**：目标落定包 `goal:settle:<status>` 相位 ⇒
 * 阻塞归因（`loopProbe` 的 `summary.md` "最近完成阶段"）可关联到目标状态。
 *
 * U5 核实结论：`phaseStack` 的 `recentPhases()`/`snapshotPhases()` → `renderSummaryMarkdown`
 * 已逐条输出 phase 名 ⇒ 本处只需断言"落定时真的产生了该相位"。
 */
describe('X7：目标落定的 loopProbe 相位标签', () => {
  test('落 blocked / failed 各产生 goal:settle:<status> 相位', async () => {
    const store = makeStore();
    resetPhaseStack();
    const goal = await store.create({
      objective: '相位归因',
      sessionId: 'sess-phase',
    });

    await settleGoalForRun({
      sessionId: 'sess-phase',
      outcome: { allPassed: false, okCount: 1, cancelled: false },
      store,
    });
    expect(recentPhases().map((p) => p.name)).toContain('goal:settle:blocked');

    resetPhaseStack();
    for (let i = 0; i < NO_PROGRESS_STOP_THRESHOLD; i++) {
      await settleGoalForRun({
        sessionId: 'sess-phase',
        outcome: { allPassed: false, okCount: 1, cancelled: false },
        store,
      });
    }
    expect((await store.get(goal.id))?.status).toBe('failed');
    expect(recentPhases().map((p) => p.name)).toContain('goal:settle:failed');
  });
});
