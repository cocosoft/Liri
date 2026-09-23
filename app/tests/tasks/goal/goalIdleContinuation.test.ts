/**
 * idle 触发续接（M-7 的 `continue_if_idle` 等价物，2026-09-22）。
 *
 * 缺口：目标落到 `blocked`（未达成但**非终态**）后，**没有任何调度会再推进它** ——
 * 用户不发新消息，目标就永久停在那里。
 *
 * 本组用例锁定四件事（修复前全部不成立）：
 * ① 登记：`blocked` 结算 ⇒ 登记一次唤醒，`taskId` 编码 `(goalId, streak)`，延迟 120s；
 * ② 识别：`taskId` 前缀可判别（`goalId` 含 `:` 也能正确切分）；
 * ③ **可续性闸门**：仅"目标仍 `blocked` 且 streak 未变"才放行 —— 终态（已完成/触顶/判停）
 *    与**陈旧唤醒**（期间已有新结算）都必须 no-op，否则会重复/无效注入；
 * ④ **有界性**：每次结算只登记一次 ⇒ 配合停止条件（3 次 `blocked` ⇒ 终态）续接次数有上界。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import { TaskGoalStore } from '../../../src/tasks/goal/TaskGoalStore';
import {
  IDLE_CONTINUE_DELAY_SEC,
  IDLE_CONTINUE_TASK_PREFIX,
  enqueueIdleContinuation,
  isIdleContinuationTask,
  parseIdleContinueTaskId,
  resolveIdleContinuation,
} from '../../../src/tasks/goal/goalIdleContinuation';

const createdPaths: string[] = [];
const opened: TaskGoalStore[] = [];

function makeStore(): TaskGoalStore {
  const path = join(tmpdir(), `goal-idle-${randomUUID().slice(0, 8)}.db`);
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

/** 记录调用参数的假调度器（不触真实 timer / 不写真实 WakeStore） */
function makeScheduler(): {
  calls: Array<{ sessionId: string; taskId: string; seconds: number }>;
  scheduler: {
    sleepFor: (
      sessionId: string,
      taskId: string,
      seconds: number
    ) => Promise<unknown>;
  };
} {
  const calls: Array<{ sessionId: string; taskId: string; seconds: number }> =
    [];
  return {
    calls,
    scheduler: {
      sleepFor: async (sessionId, taskId, seconds) => {
        calls.push({ sessionId, taskId, seconds });
        return { id: `wake-${calls.length}` };
      },
    },
  };
}

describe('goalIdleContinuation：taskId 识别与解析', () => {
  test('前缀识别', () => {
    expect(isIdleContinuationTask(`${IDLE_CONTINUE_TASK_PREFIX}g:1`)).toBe(
      true
    );
    expect(isIdleContinuationTask('some-other-task')).toBe(false);
  });

  test('解析 (goalId, streak)；goalId 含 `:` 时按**最后一个** `:` 切分', () => {
    expect(
      parseIdleContinueTaskId(`${IDLE_CONTINUE_TASK_PREFIX}goal-ab:2`)
    ).toEqual({ goalId: 'goal-ab', streak: 2 });
    // `POST /v1/goals` 允许用户自定义 id ⇒ 可能含 `:`
    expect(
      parseIdleContinueTaskId(`${IDLE_CONTINUE_TASK_PREFIX}my:goal:id:3`)
    ).toEqual({ goalId: 'my:goal:id', streak: 3 });
  });

  test('非法 taskId ⇒ null（非本前缀 / 无 streak / streak 非整数）', () => {
    expect(parseIdleContinueTaskId('other:x:1')).toBeNull();
    expect(
      parseIdleContinueTaskId(`${IDLE_CONTINUE_TASK_PREFIX}goal-ab`)
    ).toBeNull();
    expect(
      parseIdleContinueTaskId(`${IDLE_CONTINUE_TASK_PREFIX}goal-ab:abc`)
    ).toBeNull();
    expect(
      parseIdleContinueTaskId(`${IDLE_CONTINUE_TASK_PREFIX}:1`)
    ).toBeNull();
  });
});

describe('goalIdleContinuation：登记', () => {
  test('正常登记 ⇒ taskId 编码 (goalId, streak) 且延迟为约定值', async () => {
    const { calls, scheduler } = makeScheduler();
    const enqueued = await enqueueIdleContinuation({
      sessionId: 'sess-1',
      goalId: 'goal-ab',
      streak: 2,
      scheduler,
    });

    expect(enqueued).toBe(true);
    expect(calls).toEqual([
      {
        sessionId: 'sess-1',
        taskId: `${IDLE_CONTINUE_TASK_PREFIX}goal-ab:2`,
        seconds: IDLE_CONTINUE_DELAY_SEC,
      },
    ]);
  });

  test('无会话归属 ⇒ 不登记且不触碰调度器', async () => {
    const { calls, scheduler } = makeScheduler();
    expect(
      await enqueueIdleContinuation({ goalId: 'g', streak: 1, scheduler })
    ).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test('未启用 CG3（无调度器）⇒ 静默降级返回 false（不抛）', async () => {
    expect(
      await enqueueIdleContinuation({
        sessionId: 'sess-1',
        goalId: 'g',
        streak: 1,
        scheduler: null,
      })
    ).toBe(false);
  });
});

/** 造"停滞目标"：streak 次计数后落到 `blocked`（模块级，供多组用例复用） */
async function seedBlockedGoal(
  store: TaskGoalStore,
  streak: number
): Promise<{ goalId: string }> {
  const goal = await store.create({
    objective: '把长程目标跑通',
    sessionId: 'sess-g',
  });
  for (let i = 0; i < streak; i++) {
    await store.bumpNoProgressStreak(goal.id);
  }
  await store.updateStatus(goal.id, 'blocked');
  return { goalId: goal.id };
}

describe('goalIdleContinuation：触发时可续性闸门', () => {
  test('仍 blocked 且 streak 一致 ⇒ 放行并回目标信息', async () => {
    const store = makeStore();
    const { goalId } = await seedBlockedGoal(store, 2);

    const target = await resolveIdleContinuation({
      taskId: `${IDLE_CONTINUE_TASK_PREFIX}${goalId}:2`,
      store,
    });

    expect(target).toEqual({
      goalId,
      objective: '把长程目标跑通',
      streak: 2,
    });
  });

  test('陈旧唤醒（streak 已推进）⇒ no-op', async () => {
    const store = makeStore();
    const { goalId } = await seedBlockedGoal(store, 2);
    // 期间又结算了一次 ⇒ streak=3
    await store.bumpNoProgressStreak(goalId);

    expect(
      await resolveIdleContinuation({
        taskId: `${IDLE_CONTINUE_TASK_PREFIX}${goalId}:2`,
        store,
      })
    ).toBeNull();
  });

  test('目标已终态（completed / failed）⇒ no-op', async () => {
    const store = makeStore();
    const { goalId } = await seedBlockedGoal(store, 1);
    await store.updateStatus(goalId, 'completed');

    expect(
      await resolveIdleContinuation({
        taskId: `${IDLE_CONTINUE_TASK_PREFIX}${goalId}:1`,
        store,
      })
    ).toBeNull();
  });

  test('目标不存在 / 非本前缀 ⇒ no-op', async () => {
    const store = makeStore();
    expect(
      await resolveIdleContinuation({
        taskId: `${IDLE_CONTINUE_TASK_PREFIX}missing:1`,
        store,
      })
    ).toBeNull();
    expect(
      await resolveIdleContinuation({ taskId: 'other:x:1', store })
    ).toBeNull();
  });
});

describe('goalIdleContinuation：有界性（不做无限自动续跑）', () => {
  test('每个 streak 只对应一个可放行的唤醒；判停后全部作废', async () => {
    const store = makeStore();
    const { goalId } = await seedBlockedGoal(store, 1);

    // streak=1 的唤醒可放行
    expect(
      await resolveIdleContinuation({
        taskId: `${IDLE_CONTINUE_TASK_PREFIX}${goalId}:1`,
        store,
      })
    ).not.toBeNull();

    // 推进到停止阈值 ⇒ 终态 failed（`goalRunBinding` 的停止条件）
    await store.bumpNoProgressStreak(goalId);
    await store.bumpNoProgressStreak(goalId);
    await store.updateStatus(goalId, 'failed');

    // 任何历史唤醒都不再放行 ⇒ 自动续跑次数有上界
    for (const streak of [1, 2, 3]) {
      expect(
        await resolveIdleContinuation({
          taskId: `${IDLE_CONTINUE_TASK_PREFIX}${goalId}:${streak}`,
          store,
        })
      ).toBeNull();
    }
  });
});
