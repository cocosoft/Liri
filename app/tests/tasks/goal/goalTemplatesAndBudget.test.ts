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
  test('4 条续接指令**逐字锁定**（改动文案须同批更新本断言）', () => {
    expect(CONTINUATION_TEMPLATES.empty).toBe(
      '上一次尝试没有产出用户可见的回答。请从当前状态继续，现在就给出可见的回答。不要从头重来。'
    );
    expect(CONTINUATION_TEMPLATES.reasoning).toBe(
      '上一轮助手只留下了推理过程，没有产出用户可见的回答。请从该未完成的轮次继续，现在就给出可见的回答。不要复述推理，也不要从头重来。'
    );
    expect(CONTINUATION_TEMPLATES.planning).toBe(
      '上一轮助手只描述了计划。不要复述计划。现在就开始行动：执行你能做的第一个具体工具操作。如果确有阻塞导致无法行动，用一句话说明确切的阻塞点。'
    );
    expect(CONTINUATION_TEMPLATES.truncated).toBe(
      '你上一次的输出在完成前被输出长度上限截断。不要复述任何已写过的内容，也不要重新进入推理。直接从输出中断处继续：如果你正要调用工具，现在就发出这些工具调用；否则简要地把可见回答写完。'
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

  test('mermaid_repair（P1-1②，2026-09-28）：{{issues}} 渲染 + 缺参保持字面量', () => {
    const issues = '- 第 1 个图表（起始行 3）：无法识别的图类型「graphx TD」';
    const text = renderGoalTemplate('mermaid_repair', { issues });

    expect(text).toContain(issues);
    expect(text).not.toContain('{{issues}}');
    // 修正轮**取代**坏正文 ⇒ 指令必须明确"重发完整回复"，否则用户会丢失非图表部分
    expect(text).toContain('完整内容');

    // 既有契约：未提供的占位符保持字面量（便于发现漏传，而非静默留空）
    expect(renderGoalTemplate('mermaid_repair')).toContain('{{issues}}');
  });

  test('continue_goal（idle 触发续接，2026-09-22）：目标与 streak 渲染 + "续推不重做"语义', () => {
    const text = renderGoalTemplate('continue_goal', {
      objective: '把长程目标跑通',
      streak: 2,
    });

    expect(text).toContain('"把长程目标跑通"');
    expect(text).toContain('连续 2 批没有取得进展');
    expect(text).not.toContain('{{');
    // 必须是"继续推进"而不是"从头再来"，且给出阻塞时的退出口
    expect(text).toContain('请从当前状态继续朝它推进');
    expect(text).toContain('不要重做已经完成的工作');
    expect(text).toContain('说明确切的阻塞点');
  });

  test('progress_stalled（停止条件，2026-09-22）：占位符替换 + 停止语义齐全', () => {
    const text = renderGoalTemplate('progress_stalled', {
      streak: 3,
      objective: '把长程目标跑通',
    });

    // 数值与目标都渲染进去（"为何停下"对模型与用户都可读）
    expect(text).toContain('连续 3 批没有取得进展');
    expect(text).toContain('"把长程目标跑通"');
    expect(text).not.toContain('{{');
    // 停止 + 盘点语义（与 budget_limit 同族：不静默停摆）
    expect(text).toContain('停止在其上尝试新工作');
    expect(text).toContain('已完成的内容');
    expect(text).toContain('具体是什么阻碍了进展');
    expect(text).toContain('需要用户决定或提供什么');
  });

  test('budget_limit：占位符被替换（含数字）', () => {
    const text = renderGoalTemplate('budget_limit', {
      tokensUsed: 1200,
      tokenBudget: 1000,
    });
    expect(text).toContain('(1200/1000)');
    expect(text).not.toContain('{{');
    // 收尾语义的三点要求必须在文案里（"为何停下 + 下一步"可被模型照做）
    expect(text).toContain('已完成的内容');
    expect(text).toContain('剩余的内容');
    expect(text).toContain('唯一动作');
  });

  test('objective_updated：占位符被替换；未提供的占位符**保持字面量**', () => {
    expect(
      renderGoalTemplate('objective_updated', { objective: '改做 B 而非 A' })
    ).toContain('"改做 B 而非 A"');

    // 少传参数 ⇒ 保留 {{...}}（便于发现漏传，而非静默留空）
    const partial = renderGoalTemplate('budget_limit', { tokensUsed: 5 });
    expect(partial).toContain('(5/{{tokenBudget}})');
  });

  /**
   * **B2-3 收尾迁移（2026-09-23，Spec §5.3.1 #2/#3）**：两条"残余硬编码"迁入模板源。
   *
   * 逐字锁定迁移结果 —— 迁移只改**存放位置**，注入正文不得变（V8 的反向保障：
   * 若有人在此处改文案，本断言即翻红）。
   */
  test('resume_agent / tool_execution_errors：逐字迁移（文案不变）', () => {
    expect(CONTINUATION_TEMPLATES.resume_agent).toBe(
      '从你上次中断的地方继续。你可以访问上方完整的对话历史。'
    );
    expect(GOAL_TEMPLATES.tool_execution_errors).toBe(
      '上一轮 {{count}} 个工具调用在执行阶段发生异常，请告知用户遇到了什么问题，并根据当前已完成的部分给出总结或建议下一步操作。'
    );
    // `[SYSTEM] ` 前缀是**注入通道标记**（协议），不属文案 ⇒ 模板内不得含它
    expect(GOAL_TEMPLATES.tool_execution_errors.startsWith('[SYSTEM]')).toBe(
      false
    );

    // 渲染：占位被替换（与 `TAORLoop` 注入点同口径：注入点才拼 `[SYSTEM] ` 前缀）
    const rendered = renderGoalTemplate('tool_execution_errors', { count: 3 });
    expect(rendered).toBe(
      '上一轮 3 个工具调用在执行阶段发生异常，请告知用户遇到了什么问题，并根据当前已完成的部分给出总结或建议下一步操作。'
    );
    // 迁移前 TAORLoop 注入的正文（含前缀）也应能由"模板 + 注入点拼装"逐字复现
    expect(`[SYSTEM] ${rendered}`).toBe(
      '[SYSTEM] 上一轮 3 个工具调用在执行阶段发生异常，请告知用户遇到了什么问题，并根据当前已完成的部分给出总结或建议下一步操作。'
    );
    expect(rendered).not.toContain('{{');
    expect(getGoalTemplate('resume_agent')).toBe(
      CONTINUATION_TEMPLATES.resume_agent
    );
    expect(getGoalTemplate('tool_execution_errors')).toBe(
      GOAL_TEMPLATES.tool_execution_errors
    );
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
