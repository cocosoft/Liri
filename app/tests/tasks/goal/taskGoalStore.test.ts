/**
 * TaskGoalStore（M-6，2026-09-22）：长程任务**目标**实体持久化。
 *
 * 锁定 spec（`.trae/specs/long-horizon-goal-entity.md` §3/§5）：
 * - 6 态 + **终态不可改写**（I4 单向状态机）；
 * - `blocked` **非终态**（可恢复为 `active`）；
 * - `tokens_used` 累加写；`token_budget` 只回答"是否触顶"（策略不在此层）；
 * - **跨实例持久化**（新建 store 读同一 DB 仍能取到 ⇒ 证明落盘）。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import {
  TaskGoalStore,
  canTransitionGoal,
  isTerminalGoalStatus,
  type TaskGoalStatus,
} from '../../../src/tasks/goal/TaskGoalStore';
import { Database } from '@modules/core/external/sqlite3';

const createdPaths: string[] = [];
const opened: TaskGoalStore[] = [];

function makeStore(): TaskGoalStore {
  const path = join(tmpdir(), `task-goals-${randomUUID().slice(0, 8)}.db`);
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

describe('TaskGoalStore：建表与字段往返', () => {
  test('init 幂等；create 后字段完整往返', async () => {
    const store = makeStore();
    await store.init();
    await store.init(); // 幂等

    const goal = await store.create({
      objective: '把长程任务的目标落成实体',
      sessionId: 'sess-g1',
      tokenBudget: 1000,
    });

    const read = await store.get(goal.id);
    expect(read).not.toBeNull();
    expect(read?.objective).toBe('把长程任务的目标落成实体');
    expect(read?.sessionId).toBe('sess-g1');
    expect(read?.status).toBe('active');
    expect(read?.tokenBudget).toBe(1000);
    expect(read?.tokensUsed).toBe(0);
    expect(read?.createdAt).toBeGreaterThan(0);
  });

  test('未指定 sessionId / tokenBudget ⇒ 往返为 undefined（空即空，不造默认值）', async () => {
    const store = makeStore();
    const goal = await store.create({ objective: '无归属目标' });
    const read = await store.get(goal.id);
    expect(read?.sessionId).toBeUndefined();
    expect(read?.tokenBudget).toBeUndefined();
  });

  test('**跨实例持久化**：新建 store 读同一 DB 仍能取到', async () => {
    const path = join(tmpdir(), `task-goals-x-${randomUUID().slice(0, 8)}.db`);
    createdPaths.push(path);
    const first = new TaskGoalStore(path);
    const created = await first.create({ objective: '持久化验证' });
    first.close();

    const second = new TaskGoalStore(path);
    opened.push(second);
    const read = await second.get(created.id);
    expect(read?.objective).toBe('持久化验证');
  });
});

describe('TaskGoalStore：状态机（6 态 + 终态不可改写）', () => {
  test('canTransitionGoal：active ⇄ blocked 合法；终态 → 任何 非法', () => {
    expect(canTransitionGoal('active', 'blocked')).toBe(true);
    expect(canTransitionGoal('blocked', 'active')).toBe(true);
    expect(canTransitionGoal('active', 'completed')).toBe(true);
    expect(canTransitionGoal('active', 'budget_limited')).toBe(true);
    expect(canTransitionGoal('active', 'active')).toBe(false);
    expect(canTransitionGoal('blocked', 'blocked')).toBe(false);

    const terminals: TaskGoalStatus[] = [
      'completed',
      'budget_limited',
      'failed',
      'cancelled',
    ];
    for (const terminal of terminals) {
      expect(isTerminalGoalStatus(terminal)).toBe(true);
      for (const to of [
        'active',
        'blocked',
        'completed',
        'budget_limited',
        'failed',
        'cancelled',
      ] as TaskGoalStatus[]) {
        expect(canTransitionGoal(terminal, to)).toBe(false);
      }
    }
  });

  test('updateStatus 经状态机：active→blocked→active 成功；终态后一律拒绝', async () => {
    const store = makeStore();
    const goal = await store.create({ objective: '受阻再恢复' });

    expect(await store.updateStatus(goal.id, 'blocked')).toBe(true);
    expect((await store.get(goal.id))?.status).toBe('blocked');
    expect(await store.updateStatus(goal.id, 'active')).toBe(true);
    expect((await store.get(goal.id))?.status).toBe('active');

    expect(await store.updateStatus(goal.id, 'completed')).toBe(true);
    expect((await store.get(goal.id))?.status).toBe('completed');
    // 终态不可改写（修复前若为无条件 UPDATE，这里会被改回 active）
    expect(await store.updateStatus(goal.id, 'active')).toBe(false);
    expect(await store.updateStatus(goal.id, 'failed')).toBe(false);
    expect((await store.get(goal.id))?.status).toBe('completed');
  });

  test('updateStatus：目标不存在 ⇒ false（不抛）', async () => {
    const store = makeStore();
    expect(await store.updateStatus('goal-missing', 'completed')).toBe(false);
  });

  test('6 态均可作为终态落定（含 budget_limited）', async () => {
    const store = makeStore();
    for (const terminal of [
      'completed',
      'budget_limited',
      'failed',
      'cancelled',
    ] as TaskGoalStatus[]) {
      const goal = await store.create({ objective: `终态 ${terminal}` });
      expect(await store.updateStatus(goal.id, terminal)).toBe(true);
      expect((await store.get(goal.id))?.status).toBe(terminal);
    }
  });
});

describe('TaskGoalStore：用量与预算事实', () => {
  test('addUsage 累加；非法值（≤0/NaN）返回原值', async () => {
    const store = makeStore();
    const goal = await store.create({ objective: '累加' });

    expect(await store.addUsage(goal.id, 100)).toBe(100);
    expect(await store.addUsage(goal.id, 250)).toBe(350);
    expect(await store.addUsage(goal.id, 0)).toBe(350);
    expect(await store.addUsage(goal.id, Number.NaN)).toBe(350);
    expect(await store.addUsage('goal-missing', 10)).toBeNull();
  });

  test('isBudgetExceeded：未设预算恒 false；触顶为 true（不落状态）', async () => {
    const store = makeStore();
    const noBudget = await store.create({ objective: '无预算' });
    await store.addUsage(noBudget.id, 9999);
    expect(await store.isBudgetExceeded(noBudget.id)).toBe(false);

    const budgeted = await store.create({
      objective: '有预算',
      tokenBudget: 100,
    });
    await store.addUsage(budgeted.id, 60);
    expect(await store.isBudgetExceeded(budgeted.id)).toBe(false);
    await store.addUsage(budgeted.id, 40);
    expect(await store.isBudgetExceeded(budgeted.id)).toBe(true);
    // 只回答事实：状态仍为 active（"触顶 ⇒ 收尾"属 M-8 策略层）
    expect((await store.get(budgeted.id))?.status).toBe('active');
  });
});

describe('TaskGoalStore：查询与清理', () => {
  test('listActive 只含非终态，且可按会话过滤', async () => {
    const store = makeStore();
    const a = await store.create({ objective: 'A', sessionId: 's1' });
    const b = await store.create({ objective: 'B', sessionId: 's1' });
    const c = await store.create({ objective: 'C', sessionId: 's2' });
    await store.updateStatus(b.id, 'completed');
    await store.updateStatus(c.id, 'blocked');

    const s1Active = await store.listActive('s1');
    expect(s1Active.map((g) => g.id)).toEqual([a.id]);

    const allActive = await store.listActive();
    expect(allActive.map((g) => g.id).sort()).toEqual([a.id, c.id].sort());

    expect((await store.listBySession('s1')).map((g) => g.id)).toEqual([
      a.id,
      b.id,
    ]);
  });

  test('remove：首次 true、再次 false（物理删除，仅供测试/清理）', async () => {
    const store = makeStore();
    const goal = await store.create({ objective: '待删' });
    expect(await store.remove(goal.id)).toBe(true);
    expect(await store.remove(goal.id)).toBe(false);
    expect(await store.get(goal.id)).toBeNull();
  });
});

/**
 * **连续未达成批次数**（停止条件的计数据，2026-09-22）。
 *
 * 本层**只记数、不判策略**（spec §3 D4）："达阈值 ⇒ 停止"在 `goalRunBinding`。
 * 关键性质：终态目标不再计数（与"终态不可改写"同源）；跨实例持久化；
 * 已建表的旧库经**增量加列**迁移后读到 0（不是 `NaN`）。
 */
describe('TaskGoalStore：连续无进展计数', () => {
  test('新建目标 ⇒ streak 为 0', async () => {
    const store = makeStore();
    const goal = await store.create({ objective: '新目标' });
    expect(goal.noProgressStreak).toBe(0);
    expect((await store.get(goal.id))?.noProgressStreak).toBe(0);
  });

  test('bumpNoProgressStreak 累加；目标不存在 ⇒ null', async () => {
    const store = makeStore();
    const goal = await store.create({ objective: '累加' });
    expect(await store.bumpNoProgressStreak(goal.id)).toBe(1);
    expect(await store.bumpNoProgressStreak(goal.id)).toBe(2);
    expect(await store.bumpNoProgressStreak('goal-missing')).toBeNull();
  });

  test('终态目标不再计数 ⇒ null 且值不变（与"终态不可改写"同源）', async () => {
    const store = makeStore();
    const goal = await store.create({ objective: '已停止' });
    await store.bumpNoProgressStreak(goal.id);
    await store.updateStatus(goal.id, 'failed');

    expect(await store.bumpNoProgressStreak(goal.id)).toBeNull();
    expect((await store.get(goal.id))?.noProgressStreak).toBe(1);
  });

  test('跨实例持久化：新 store 读同一 DB 仍能取到 streak', async () => {
    const path = join(
      tmpdir(),
      `task-goals-streak-${randomUUID().slice(0, 8)}.db`
    );
    createdPaths.push(path);
    const first = new TaskGoalStore(path);
    opened.push(first);
    const goal = await first.create({ objective: '跨实例' });
    await first.bumpNoProgressStreak(goal.id);
    await first.bumpNoProgressStreak(goal.id);

    const second = new TaskGoalStore(path);
    opened.push(second);
    expect((await second.get(goal.id))?.noProgressStreak).toBe(2);
  });

  test('增量加列迁移：旧表（无该列）被 ALTER 补列，读到 0 而非 NaN', async () => {
    const path = join(
      tmpdir(),
      `task-goals-migrate-${randomUUID().slice(0, 8)}.db`
    );
    createdPaths.push(path);

    // 造"旧结构"表：与本次改动前的 DDL 一致（**没有** no_progress_streak）
    const db = new Database(path);
    await new Promise<void>((resolve, reject) => {
      db.run(
        `CREATE TABLE task_goals (
           id           TEXT PRIMARY KEY,
           session_id   TEXT,
           objective    TEXT NOT NULL,
           status       TEXT NOT NULL,
           token_budget INTEGER,
           tokens_used  INTEGER NOT NULL DEFAULT 0,
           created_at   INTEGER NOT NULL,
           updated_at   INTEGER NOT NULL
         )`,
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });
    await new Promise<void>((resolve, reject) => {
      db.run(
        `INSERT INTO task_goals
           (id, session_id, objective, status, token_budget, tokens_used, created_at, updated_at)
         VALUES ('goal-old', NULL, '旧行', 'active', NULL, 7, 1, 1)`,
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });
    db.close();

    const store = new TaskGoalStore(path);
    opened.push(store);
    const goal = await store.get('goal-old');
    expect(goal?.objective).toBe('旧行');
    expect(goal?.tokensUsed).toBe(7);
    expect(goal?.noProgressStreak).toBe(0);
    expect(await store.bumpNoProgressStreak('goal-old')).toBe(1);
  });
});
