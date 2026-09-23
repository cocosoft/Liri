/**
 * M-7 / M-8（2026-09-22）：续接模板单一来源 + 任务级预算触顶收尾。
 *
 * - **M-7**：既有 4 条续接指令逐字迁移到 `goalTemplates`（本文件用**逐字断言锁定**，
 *   防止迁移中悄悄改文案）；新增 `budget_limit` / `objective_updated` 两条目标模板。
 * - **M-8**：`chargeGoalUsage` 记账 → 触顶 ⇒ 落 `budget_limited`（终态幂等）+ 产出
 *   `budget_limit` 收尾指令（**不静默截断**）。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import {
  CONTINUATION_TEMPLATES,
  GOAL_TEMPLATES,
  getGoalTemplate,
  renderGoalTemplate,
} from '../../../src/tasks/goal/goalTemplates';
import { chargeGoalUsage } from '../../../src/tasks/goal/goalBudget';
import { TaskGoalStore } from '../../../src/tasks/goal/TaskGoalStore';

describe('M-7：续接指令模板（逐字迁移 + 渲染）', () => {
  test('4 条既有续接指令**逐字锁定**（迁移不得改文案）', () => {
    expect(CONTINUATION_TEMPLATES.empty).toBe(
      'The previous attempt did not produce a user-visible answer. Continue from the current state and produce the visible answer now. Do not restart from scratch.'
    );
    expect(CONTINUATION_TEMPLATES.reasoning).toBe(
      'The previous assistant turn recorded reasoning but did not produce a user-visible answer. Continue from that partial turn and produce the visible answer now. Do not restate the reasoning or restart from scratch.'
    );
    expect(CONTINUATION_TEMPLATES.planning).toBe(
      'The previous assistant turn only described the plan. Do not restate the plan. Act now: take the first concrete tool action you can. If a real blocker prevents action, reply with the exact blocker in one sentence.'
    );
    expect(CONTINUATION_TEMPLATES.truncated).toBe(
      'Your previous output was cut off by the output length limit before it finished. Do NOT restate anything you already wrote and do NOT re-enter reasoning. Continue directly from where the output stopped: if you were about to call tools, emit the tool calls now; otherwise finish your visible answer concisely.'
    );
  });

  test('getGoalTemplate 与两张模板表同源', () => {
    for (const key of [
      'empty',
      'reasoning',
      'planning',
      'truncated',
    ] as const) {
      expect(getGoalTemplate(key)).toBe(CONTINUATION_TEMPLATES[key]);
    }
    expect(getGoalTemplate('budget_limit')).toBe(GOAL_TEMPLATES.budget_limit);
    expect(getGoalTemplate('objective_updated')).toBe(
      GOAL_TEMPLATES.objective_updated
    );
    expect(getGoalTemplate('progress_stalled')).toBe(
      GOAL_TEMPLATES.progress_stalled
    );
    expect(getGoalTemplate('continue_goal')).toBe(GOAL_TEMPLATES.continue_goal);
  });

  test('continue_goal（idle 触发续接，2026-09-22）：目标与 streak 渲染 + "续推不重做"语义', () => {
    const text = renderGoalTemplate('continue_goal', {
      objective: '把长程目标跑通',
      streak: 2,
    });

    expect(text).toContain('"把长程目标跑通"');
    expect(text).toContain('no progress for 2 consecutive batches');
    expect(text).not.toContain('{{');
    // 必须是"继续推进"而不是"从头再来"，且给出阻塞时的退出口
    expect(text).toContain('Continue working toward it from the current state');
    expect(text).toContain('Do NOT restart work that is already done');
    expect(text).toContain('reply with the exact blocker');
  });

  test('progress_stalled（停止条件，2026-09-22）：占位符替换 + 停止语义齐全', () => {
    const text = renderGoalTemplate('progress_stalled', {
      streak: 3,
      objective: '把长程目标跑通',
    });

    // 数值与目标都渲染进去（"为何停下"对模型与用户都可读）
    expect(text).toContain('no progress for 3 consecutive batches');
    expect(text).toContain('"把长程目标跑通"');
    expect(text).not.toContain('{{');
    // 停止 + 盘点语义（与 budget_limit 同族：不静默停摆）
    expect(text).toContain('Stop attempting new work');
    expect(text).toContain('what was completed');
    expect(text).toContain('what specifically is blocking progress');
    expect(text).toContain('what the user must decide or provide');
  });

  test('budget_limit：占位符被替换（含数字）', () => {
    const text = renderGoalTemplate('budget_limit', {
      tokensUsed: 1200,
      tokenBudget: 1000,
    });
    expect(text).toContain('(1200/1000)');
    expect(text).not.toContain('{{');
    // 收尾语义的三点要求必须在文案里（"为何停下 + 下一步"可被模型照做）
    expect(text).toContain('what was completed');
    expect(text).toContain('what remains');
    expect(text).toContain('single next action');
  });

  test('objective_updated：占位符被替换；未提供的占位符**保持字面量**', () => {
    expect(
      renderGoalTemplate('objective_updated', { objective: '改做 B 而非 A' })
    ).toContain('"改做 B 而非 A"');

    // 少传参数 ⇒ 保留 {{...}}（便于发现漏传，而非静默留空）
    const partial = renderGoalTemplate('budget_limit', { tokensUsed: 5 });
    expect(partial).toContain('(5/{{tokenBudget}})');
  });
});

describe('M-8：任务级预算触顶收尾', () => {
  const createdPaths: string[] = [];
  const opened: TaskGoalStore[] = [];

  function makeStore(): TaskGoalStore {
    const path = join(tmpdir(), `goal-budget-${randomUUID().slice(0, 8)}.db`);
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

  test('未触顶 ⇒ 只记账，状态保持 active，无收尾指令', async () => {
    const store = makeStore();
    const goal = await store.create({ objective: '预算内', tokenBudget: 100 });

    const r = await chargeGoalUsage({ goalId: goal.id, tokens: 60, store });
    expect(r?.tokensUsed).toBe(60);
    expect(r?.exceeded).toBe(false);
    expect(r?.statusChanged).toBe(false);
    expect(r?.closingInstruction).toBeUndefined();
    expect((await store.get(goal.id))?.status).toBe('active');
  });

  test('触顶 ⇒ 落 budget_limited + 给出收尾指令（不静默截断）', async () => {
    const store = makeStore();
    const goal = await store.create({ objective: '会触顶', tokenBudget: 100 });

    await chargeGoalUsage({ goalId: goal.id, tokens: 60, store });
    const r = await chargeGoalUsage({ goalId: goal.id, tokens: 50, store });

    expect(r?.exceeded).toBe(true);
    expect(r?.statusChanged).toBe(true); // 首次落终态
    expect(r?.closingInstruction).toContain('(110/100)');
    expect((await store.get(goal.id))?.status).toBe('budget_limited');
  });

  test('触顶后再次记账 ⇒ 幂等：不再迁移状态（statusChanged=false）', async () => {
    const store = makeStore();
    const goal = await store.create({ objective: '幂等', tokenBudget: 10 });
    const first = await chargeGoalUsage({ goalId: goal.id, tokens: 20, store });
    expect(first?.statusChanged).toBe(true);

    const second = await chargeGoalUsage({ goalId: goal.id, tokens: 5, store });
    expect(second?.exceeded).toBe(true);
    expect(second?.statusChanged).toBe(false); // 终态不可改写
    expect((await store.get(goal.id))?.status).toBe('budget_limited');
  });

  test('未设预算 ⇒ 永不触顶（语义为"不限"）', async () => {
    const store = makeStore();
    const goal = await store.create({ objective: '无预算' });
    const r = await chargeGoalUsage({
      goalId: goal.id,
      tokens: 999_999,
      store,
    });
    expect(r?.exceeded).toBe(false);
    expect(r?.closingInstruction).toBeUndefined();
    expect((await store.get(goal.id))?.status).toBe('active');
  });

  test('目标不存在 ⇒ 返回 null（记账属观测面，不中断执行）', async () => {
    const store = makeStore();
    expect(
      await chargeGoalUsage({ goalId: 'goal-none', tokens: 1, store })
    ).toBeNull();
  });
});
