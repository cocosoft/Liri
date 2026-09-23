// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * B2-2 / 缺口 X2（2026-09-23）：目标事件族 + 「模型可见 ⇔ 已落盘」红线。
 *
 * 锁定四条硬约束（`.trae/specs/goal-entity.md` §4.1 / §4.3）：
 * 1. **注入即落盘**：目标指令（`budget_limit` / `progress_stalled` / `continue_goal`）
 *    进了模型输入（批次 tool result / 会话 user 消息），就必须有对应的 `goal/injected` 事件；
 * 2. **逐字可重建**：事件的 `text` 必须**逐字等于**实际注入的正文（= 模板渲染结果）；
 * 3. **状态迁移成对落事件**：`goal/status_changed` 的 `from`/`to`/`reason` 是"为何停下"
 *    的机器可读唯一答案（不按文案推断）；
 * 4. **不伪造**：未注入追加器 / 无归属会话 ⇒ 不产事件（不写假事件、不抛错）。
 *
 * 「修复前必失败」取证：把 `GoalEvents.appendGoalEvent` 的落盘调用（或各生产处的
 * `emit*`/`take*` 调用）临时注释掉，本文件的注入类用例即失败 —— 见交付报告。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import type { LiriEvent } from '../../../src/chat/types/events';
import type { LiriEventMap } from '../../../src/chat/types/eventPayloads';
import { TaskGoalStore } from '../../../src/tasks/goal/TaskGoalStore';
import {
  settleGoalForRun,
  NO_PROGRESS_STOP_THRESHOLD,
} from '../../../src/tasks/goal/goalRunBinding';
import { chargeGoalUsage } from '../../../src/tasks/goal/goalBudget';
import { renderGoalTemplate } from '../../../src/tasks/goal/goalTemplates';
import {
  emitGoalCreated,
  setGoalEventSink,
  takeBatchGoalInstruction,
  takeIdleContinuationInstruction,
} from '../../../src/tasks/goal/GoalEvents';

const createdPaths: string[] = [];
const opened: TaskGoalStore[] = [];

function makeStore(): TaskGoalStore {
  const path = join(tmpdir(), `goal-events-${randomUUID().slice(0, 8)}.db`);
  createdPaths.push(path);
  const store = new TaskGoalStore(path);
  opened.push(store);
  return store;
}

/**
 * 内存追加器：模拟 `EventLogStorage.append` 的 seq 原子分配（seq<=0 ⇒ 分配 tail+1）。
 * 与 `tests/chat/requestBoundary.test.ts` 同法（只模拟 seq 分配，不模拟事件内容）。
 */
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

/** 按类型取事件载荷（收窄类型，供断言用） */
function payloads<
  T extends 'goal/created' | 'goal/status_changed' | 'goal/injected',
>(events: LiriEvent[], type: T): LiriEventMap[T][] {
  return events
    .filter((e) => e.type === type)
    .map((e) => e.data as LiriEventMap[T]);
}

/** 状态迁移的可重建摘要（"为何停下"的唯一答案） */
function transitions(events: LiriEvent[]): string[] {
  return payloads(events, 'goal/status_changed').map(
    (d) => `${d.from}->${d.to}:${d.reason}`
  );
}

afterEach(() => {
  setGoalEventSink(null);
  while (opened.length > 0) opened.pop()!.close();
  while (createdPaths.length > 0) {
    try {
      unlinkSync(createdPaths.pop()!);
    } catch {
      // @ignore-catch — 清理临时文件失败不影响断言
    }
  }
});

describe('X2 红线：目标指令注入即落盘（tool_result 通道）', () => {
  test('budget_limit：注入正文与事件 text **逐字一致**（= 模板渲染结果）', async () => {
    const store = makeStore();
    const events = makeSink();
    const goal = await store.create({
      objective: '会触顶的目标',
      sessionId: 'sess-budget',
      tokenBudget: 100,
    });

    const settlement = await settleGoalForRun({
      sessionId: 'sess-budget',
      outcome: { allPassed: true, okCount: 1, cancelled: false },
      tokens: 150,
      store,
    });
    expect(settlement?.status).toBe('budget_limited');

    // AgentTool 的取指令点：返回即注入正文
    const injection = await takeBatchGoalInstruction({
      sessionId: 'sess-budget',
      settlement: settlement!,
    });

    const expected = renderGoalTemplate('budget_limit', {
      tokensUsed: 150,
      tokenBudget: 100,
    });
    expect(injection?.templateKind).toBe('budget_limit');
    expect(injection?.text).toBe(expected); // 注入正文 == 模板渲染（不是另一份文本）

    // 事件已**先于注入**落盘，且载荷与我们即将注入的正文完全一致
    expect(payloads(events, 'goal/injected')).toEqual([
      {
        goalId: goal.id,
        templateKind: 'budget_limit',
        channel: 'tool_result',
        text: expected,
      },
    ]);
  });

  test('progress_stalled：注入正文 = 收口给出的 stopInstruction 且逐字入事件', async () => {
    const store = makeStore();
    const events = makeSink();
    const goal = await store.create({
      objective: '反复受阻的目标',
      sessionId: 'sess-stall',
    });

    let settlement: Awaited<ReturnType<typeof settleGoalForRun>> = null;
    for (let i = 0; i < NO_PROGRESS_STOP_THRESHOLD; i++) {
      settlement = await settleGoalForRun({
        sessionId: 'sess-stall',
        outcome: { allPassed: false, okCount: 1, cancelled: false },
        store,
      });
    }
    expect(settlement?.status).toBe('failed');

    const injection = await takeBatchGoalInstruction({
      sessionId: 'sess-stall',
      settlement: settlement!,
    });

    const expected = renderGoalTemplate('progress_stalled', {
      streak: NO_PROGRESS_STOP_THRESHOLD,
      objective: '反复受阻的目标',
    });
    expect(injection?.text).toBe(expected);
    expect(injection?.text).toBe(settlement!.stopInstruction);

    expect(payloads(events, 'goal/injected')).toEqual([
      {
        goalId: goal.id,
        templateKind: 'progress_stalled',
        channel: 'tool_result',
        text: expected,
      },
    ]);
  });

  test('无指令（达成且未触顶）⇒ 不注入、不产事件', async () => {
    const store = makeStore();
    const events = makeSink();
    await store.create({ objective: '一次过', sessionId: 'sess-none-inject' });

    const settlement = await settleGoalForRun({
      sessionId: 'sess-none-inject',
      outcome: { allPassed: true, okCount: 2, cancelled: false },
      store,
    });

    expect(
      await takeBatchGoalInstruction({
        sessionId: 'sess-none-inject',
        settlement: settlement!,
      })
    ).toBeUndefined();
    expect(payloads(events, 'goal/injected')).toHaveLength(0);
  });
});

describe('X2 红线：目标指令注入即落盘（user_message 通道）', () => {
  test('continue_goal：渲染与落盘同源，返回正文 == 事件 text', async () => {
    const events = makeSink();

    const text = await takeIdleContinuationInstruction({
      sessionId: 'sess-idle',
      goalId: 'goal-idle',
      objective: '把长程目标跑通',
      streak: 2,
    });

    const expected = renderGoalTemplate('continue_goal', {
      objective: '把长程目标跑通',
      streak: 2,
    });
    expect(text).toBe(expected); // 注入正文 == 模板渲染

    expect(payloads(events, 'goal/injected')).toEqual([
      {
        goalId: 'goal-idle',
        templateKind: 'continue_goal',
        channel: 'user_message',
        text: expected,
      },
    ]);
  });
});

describe('可重建性：仅凭事件序列还原"注入给模型的 goal 指令"', () => {
  test('三类注入的正文集合与状态迁移序列均可由事件重建', async () => {
    const store = makeStore();
    const events = makeSink();

    // ① budget_limit（tool_result）
    const budgetGoal = await store.create({
      objective: '预算目标',
      sessionId: 'sess-r-budget',
      tokenBudget: 10,
    });
    const budgetSettlement = await settleGoalForRun({
      sessionId: 'sess-r-budget',
      outcome: { allPassed: true, okCount: 1, cancelled: false },
      tokens: 20,
      store,
    });
    await takeBatchGoalInstruction({
      sessionId: 'sess-r-budget',
      settlement: budgetSettlement!,
    });

    // ② progress_stalled（tool_result）
    await store.create({ objective: '停滞目标', sessionId: 'sess-r-stall' });
    let stallSettlement: Awaited<ReturnType<typeof settleGoalForRun>> = null;
    for (let i = 0; i < NO_PROGRESS_STOP_THRESHOLD; i++) {
      stallSettlement = await settleGoalForRun({
        sessionId: 'sess-r-stall',
        outcome: { allPassed: false, okCount: 1, cancelled: false },
        store,
      });
    }
    await takeBatchGoalInstruction({
      sessionId: 'sess-r-stall',
      settlement: stallSettlement!,
    });

    // ③ continue_goal（user_message）
    const continuation = await takeIdleContinuationInstruction({
      sessionId: 'sess-r-idle',
      goalId: 'goal-r-idle',
      objective: '续接目标',
      streak: 1,
    });

    // 只看事件序列（不重新渲染模板）即可还原注入正文
    const reconstructed = payloads(events, 'goal/injected').map((d) => d.text);
    expect(reconstructed).toEqual([
      budgetSettlement!.closingInstruction,
      stallSettlement!.stopInstruction,
      continuation,
    ]);
    expect(reconstructed[0]).toContain('(20/10)');
    expect(reconstructed[1]).toContain('停滞目标');
    expect(reconstructed[2]).toContain('续接目标');

    // "为何停下"同样可由事件重建（机器可读，不靠文案）
    expect(transitions(events)).toEqual([
      `active->budget_limited:budget_limit`,
      `active->blocked:batch_blocked`,
      `blocked->failed:stop_threshold`,
    ]);
    expect(payloads(events, 'goal/status_changed')[0].goalId).toBe(
      budgetGoal.id
    );
  });
});

describe('目标生命周期事件族（B2-2）', () => {
  test('created：有归属会话 ⇒ 落 goal/created（含 objective 与预算）', async () => {
    const events = makeSink();
    await emitGoalCreated({
      goalId: 'goal-c1',
      objective: '新目标',
      sessionId: 'sess-c1',
      tokenBudget: 500,
    });
    expect(payloads(events, 'goal/created')).toEqual([
      {
        goalId: 'goal-c1',
        objective: '新目标',
        sessionId: 'sess-c1',
        tokenBudget: 500,
      },
    ]);
  });

  test('created：无归属会话 ⇒ 不产事件（会话事件无处可落，不硬凑）', async () => {
    const events = makeSink();
    await emitGoalCreated({ goalId: 'goal-c2', objective: '无会话目标' });
    expect(events).toHaveLength(0);
  });

  test('status_changed：批次全通过 ⇒ active→completed（reason=batch_completed）', async () => {
    const store = makeStore();
    const events = makeSink();
    const goal = await store.create({
      objective: '达成 A',
      sessionId: 'sess-ok',
    });

    await settleGoalForRun({
      sessionId: 'sess-ok',
      outcome: { allPassed: true, okCount: 2, cancelled: false },
      store,
    });

    expect(payloads(events, 'goal/status_changed')).toEqual([
      {
        goalId: goal.id,
        from: 'active',
        to: 'completed',
        reason: 'batch_completed',
        tokensUsed: 0,
        noProgressStreak: 0,
      },
    ]);
  });

  test('status_changed：批次取消 / 全败 ⇒ 各有专属 reason', async () => {
    const store = makeStore();
    const events = makeSink();
    await store.create({ objective: '取消的目标', sessionId: 'sess-cancel-e' });
    await store.create({ objective: '全败的目标', sessionId: 'sess-fail-e' });

    await settleGoalForRun({
      sessionId: 'sess-cancel-e',
      outcome: { allPassed: false, okCount: 0, cancelled: true },
      store,
    });
    await settleGoalForRun({
      sessionId: 'sess-fail-e',
      outcome: { allPassed: false, okCount: 0, cancelled: false },
      store,
    });

    expect(transitions(events)).toEqual([
      'active->cancelled:batch_cancelled',
      'active->failed:batch_failed',
    ]);
  });

  test('status_changed：预算触顶 ⇒ active→budget_limited（且重复记账不产第二条）', async () => {
    const store = makeStore();
    const events = makeSink();
    const goal = await store.create({
      objective: '触顶目标',
      sessionId: 'sess-budget-e',
      tokenBudget: 100,
    });

    await chargeGoalUsage({ goalId: goal.id, tokens: 60, store });
    expect(payloads(events, 'goal/status_changed')).toHaveLength(0); // 未触顶 ⇒ 无迁移

    const charge = await chargeGoalUsage({
      goalId: goal.id,
      tokens: 50,
      store,
    });
    expect(charge?.statusChanged).toBe(true);
    expect(payloads(events, 'goal/status_changed')).toEqual([
      {
        goalId: goal.id,
        from: 'active',
        to: 'budget_limited',
        reason: 'budget_limit',
        tokensUsed: 110,
        tokenBudget: 100,
      },
    ]);

    // 触顶后继续记账 ⇒ 幂等：不再迁移，也不产第二条事件
    await chargeGoalUsage({ goalId: goal.id, tokens: 5, store });
    expect(payloads(events, 'goal/status_changed')).toHaveLength(1);
  });

  test('status_changed：**无迁移**（blocked→blocked 同态）⇒ 不产事件（不谎报）', async () => {
    const store = makeStore();
    const events = makeSink();
    await store.create({ objective: '慢目标', sessionId: 'sess-same' });

    for (let i = 0; i < NO_PROGRESS_STOP_THRESHOLD - 1; i++) {
      await settleGoalForRun({
        sessionId: 'sess-same',
        outcome: { allPassed: false, okCount: 1, cancelled: false },
        store,
      });
    }

    // 第 1 次 active→blocked 有事件；其后 blocked→blocked 无迁移 ⇒ 无事件
    expect(transitions(events)).toEqual(['active->blocked:batch_blocked']);
  });
});

describe('不伪造：未装配追加器 / 追加器异常时的行为', () => {
  test('未注入追加器 ⇒ 不产事件，但指令渲染照常返回（观测面失败不影响注入）', async () => {
    const events = makeSink();
    setGoalEventSink(null);

    const text = await takeIdleContinuationInstruction({
      sessionId: 'sess-no-sink',
      goalId: 'goal-no-sink',
      objective: '无 sink 目标',
      streak: 1,
    });

    expect(text).toBe(
      renderGoalTemplate('continue_goal', {
        objective: '无 sink 目标',
        streak: 1,
      })
    );
    expect(events).toHaveLength(0); // 不伪造事件
  });

  test('追加器抛异常 ⇒ 不抛出，注入正文照常返回（CS03：观测面不得中断主流程）', async () => {
    setGoalEventSink(async () => {
      throw new Error('disk full');
    });

    const text = await takeIdleContinuationInstruction({
      sessionId: 'sess-boom',
      goalId: 'goal-boom',
      objective: '异常目标',
      streak: 1,
    });
    expect(text.length).toBeGreaterThan(0);
  });
});
