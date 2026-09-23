/**
 * X8（2026-09-23，Spec `.trae/specs/goal-entity.md` §5.5）：**主会话用量入账 + 收尾注入通道**。
 *
 * 覆盖三点（方案 A：记账与判定解耦）：
 * - **记账**（主会话这一半）：`chargeSessionGoalUsage` 把主会话用量记到该会话的未终结目标上；
 *   接线点在 `ChatManager.recordChatResponseUsage`（见 `tests/chat/goalUsageAccounting.test.ts`）；
 * - **判定 + 注入**（"下一轮请求前"）：`injectMainSessionBudgetWrapUp` —— 认领（幂等持久化标记）
 *   ⇒ 渲染 + 落盘（`goal/injected{channel:'steering'}`）⇒ 交给 steering 通道；
 * - **幂等**：`budget_limit_reported_at` 的**单条条件 UPDATE + `changes` 判首次**，
 *   同一目标只注入一次，且**跨实例/重开 store** 同样不重复。
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
  chargeGoalUsage,
  chargeSessionGoalUsage,
  injectMainSessionBudgetWrapUp,
} from '../../../src/tasks/goal/goalBudget';
import { setGoalEventSink } from '../../../src/tasks/goal/GoalEvents';
import { renderGoalTemplate } from '../../../src/tasks/goal/goalTemplates';

const createdPaths: string[] = [];
const opened: TaskGoalStore[] = [];

function makePath(): string {
  const path = join(tmpdir(), `goal-wrapup-${randomUUID().slice(0, 8)}.db`);
  createdPaths.push(path);
  return path;
}

/**
 * 开库：**默认内存库**（`:memory:`）—— 无临时文件 ⇒ 无清理负担。
 *
 * 为什么不用临时文件做默认：Windows 上 sqlite3 连接的句柄由 `close()` **异步**释放，
 * 紧接 `unlinkSync` 常 `EBUSY`（既有 `taskGoalStore.test.ts` 等文件只 try 一次 ⇒
 * 本机实测 `%TEMP%` 已残留数百个 `.db`）。只有**跨实例持久化**用例必须落文件。
 */
function openStore(path: string = ':memory:'): TaskGoalStore {
  const store = new TaskGoalStore(path);
  opened.push(store);
  return store;
}

/** 内存追加器（只模拟 seq 分配；与 `goalBudgetAtomic.test.ts` 同法） */
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

/** 只取 `goal/injected` 事件载荷（本文件的断言对象） */
function injectedEvents(written: LiriEvent[]): LiriEventMap['goal/injected'][] {
  return written
    .filter((e) => e.type === 'goal/injected')
    .map((e) => e.data as LiriEventMap['goal/injected']);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 删除临时库（仅**跨实例**用例会落文件）：句柄异步释放 ⇒ **短窗口有界重试**
 * （15 × 100ms，仍远低于 bun 的 5s hook 超时）；仍删不掉就**如实放弃**（不假装成功）。
 */
async function removeDb(path: string): Promise<void> {
  for (let i = 0; i < 15; i++) {
    try {
      unlinkSync(path);
      return;
    } catch {
      // @ignore-catch — 句柄尚未释放，等一个短周期后重试
      await sleep(100);
    }
  }
}

afterEach(async () => {
  setGoalEventSink(null);
  while (opened.length > 0) opened.pop()!.close();
  while (createdPaths.length > 0) {
    await removeDb(createdPaths.pop()!);
  }
});

describe('X8：主会话用量入账（记账与判定解耦的"记账"侧）', () => {
  test('把用量记到该会话**未终结目标**上（tokensUsed 累加）', async () => {
    const store = openStore();
    const goal = await store.create({
      sessionId: 'sess-acc',
      objective: '主会话记账',
      tokenBudget: 10_000,
    });

    const r = await chargeSessionGoalUsage({
      sessionId: 'sess-acc',
      tokens: 120,
      store,
    });

    expect(r?.goalId).toBe(goal.id);
    expect(r?.tokensUsed).toBe(120);
    expect((await store.get(goal.id))?.tokensUsed).toBe(120);
    expect((await store.get(goal.id))?.status).toBe('active');
  });

  test('该会话无未终结目标 ⇒ null（不建行、不写库）', async () => {
    const store = openStore();
    expect(
      await chargeSessionGoalUsage({
        sessionId: 'sess-nothing',
        tokens: 99,
        store,
      })
    ).toBeNull();
    expect(await store.listBySession('sess-nothing')).toEqual([]);
  });

  test('只记到**本会话**的目标上（别会话目标零影响）', async () => {
    const store = openStore();
    const mine = await store.create({
      sessionId: 'sess-a',
      objective: '本会话目标',
      tokenBudget: 10_000,
    });
    const other = await store.create({
      sessionId: 'sess-b',
      objective: '别会话目标',
      tokenBudget: 10_000,
    });

    await chargeSessionGoalUsage({ sessionId: 'sess-a', tokens: 30, store });

    expect((await store.get(mine.id))?.tokensUsed).toBe(30);
    expect((await store.get(other.id))?.tokensUsed).toBe(0);
  });
});

describe('X8：主会话预算触顶 ⇒ 下一轮请求前经 steering 注入（幂等，只 1 次）', () => {
  test('触顶后注入 1 次：steering 收到正文，且事件 text 与注入正文**逐字一致**', async () => {
    const store = openStore();
    const written = makeSink();
    const goal = await store.create({
      sessionId: 'sess-main',
      objective: '主会话预算收尾',
      tokenBudget: 100,
    });
    // 触顶（记账侧）：落 budget_limited 终态
    await chargeGoalUsage({ goalId: goal.id, tokens: 150, store });
    expect((await store.get(goal.id))?.status).toBe('budget_limited');

    const steered: string[] = [];
    const injected = await injectMainSessionBudgetWrapUp({
      sessionId: 'sess-main',
      steer: (text) => steered.push(text),
      store,
    });

    const expected = renderGoalTemplate('budget_limit', {
      tokensUsed: 150,
      tokenBudget: 100,
    });
    // ① steering 通道收到正文（注入 1 次）
    expect(steered).toEqual([expected]);
    expect(injected).toEqual({ goalId: goal.id, text: expected });

    // ② 事件落盘：channel='steering' + templateKind='budget_limit' + text 逐字一致（§1.6 红线）
    const events = injectedEvents(written);
    expect(events.length).toBe(1);
    expect(events[0].goalId).toBe(goal.id);
    expect(events[0].channel).toBe('steering');
    expect(events[0].templateKind).toBe('budget_limit');
    expect(events[0].text).toBe(steered[0]);
    // 模板正文不含通道前缀（前缀由通道自身拼装，与 `[SYSTEM] ` 同口径）
    expect(events[0].text.startsWith('[STEERING]')).toBe(false);
  });

  test('幂等：同一目标第二次请求前不再注入（持久化标记生效）', async () => {
    const store = openStore();
    const written = makeSink();
    const goal = await store.create({
      sessionId: 'sess-main',
      objective: '只报一次',
      tokenBudget: 50,
    });
    await chargeGoalUsage({ goalId: goal.id, tokens: 60, store });

    const steered: string[] = [];
    await injectMainSessionBudgetWrapUp({
      sessionId: 'sess-main',
      steer: (text) => steered.push(text),
      store,
    });
    const second = await injectMainSessionBudgetWrapUp({
      sessionId: 'sess-main',
      steer: (text) => steered.push(text),
      store,
    });

    expect(second).toBeUndefined();
    expect(steered.length).toBe(1);
    expect(injectedEvents(written).length).toBe(1);
    // 标记已落库（判据是持久化字段，不是内存 flag）
    expect((await store.get(goal.id))?.budgetLimitReportedAt).toBeGreaterThan(
      0
    );
  });

  test('幂等（跨实例 / 重开 store）：持久化标记仍阻止重复注入', async () => {
    const path = makePath();
    const first = openStore(path);
    makeSink();
    const goal = await first.create({
      sessionId: 'sess-main',
      objective: '跨实例幂等',
      tokenBudget: 40,
    });
    await chargeGoalUsage({ goalId: goal.id, tokens: 45, store: first });

    const steeredA: string[] = [];
    await injectMainSessionBudgetWrapUp({
      sessionId: 'sess-main',
      steer: (text) => steeredA.push(text),
      store: first,
    });
    expect(steeredA.length).toBe(1);

    // 关掉连接、重开一个全新实例（模拟"重启后"）
    first.close();
    const second = openStore(path);
    const refreshed = await second.get(goal.id);
    expect(refreshed?.budgetLimitReportedAt).toBeGreaterThan(0);

    const steeredB: string[] = [];
    const again = await injectMainSessionBudgetWrapUp({
      sessionId: 'sess-main',
      steer: (text) => steeredB.push(text),
      store: second,
    });
    expect(again).toBeUndefined();
    expect(steeredB).toEqual([]);
  });

  test('范围：未触顶 / 无目标 / 别会话 ⇒ 都不注入', async () => {
    const store = openStore();
    const written = makeSink();
    const steered: string[] = [];
    const steer = (text: string): void => {
      steered.push(text);
    };

    // ① 未触顶（active）
    const active = await store.create({
      sessionId: 'sess-active',
      objective: '未触顶',
      tokenBudget: 1000,
    });
    await chargeSessionGoalUsage({
      sessionId: 'sess-active',
      tokens: 10,
      store,
    });
    expect(
      await injectMainSessionBudgetWrapUp({
        sessionId: 'sess-active',
        steer,
        store,
      })
    ).toBeUndefined();

    // ② 无目标会话
    expect(
      await injectMainSessionBudgetWrapUp({
        sessionId: 'sess-none',
        steer,
        store,
      })
    ).toBeUndefined();

    // ③ 别会话已触顶 ⇒ 对本会话不注入（按 sessionId 隔离）
    const other = await store.create({
      sessionId: 'sess-other',
      objective: '别会话触顶',
      tokenBudget: 10,
    });
    await chargeGoalUsage({ goalId: other.id, tokens: 20, store });
    expect(
      await injectMainSessionBudgetWrapUp({
        sessionId: 'sess-active',
        steer,
        store,
      })
    ).toBeUndefined();

    expect(steered).toEqual([]);
    expect(injectedEvents(written).length).toBe(0);
    expect((await store.get(active.id))?.status).toBe('active');
    // 别会话的目标仍待收尾（自己那条会话请求时才注入）
    expect(
      await injectMainSessionBudgetWrapUp({
        sessionId: 'sess-other',
        steer,
        store,
      })
    ).toBeDefined();
    expect(steered.length).toBe(1);
  });
});
