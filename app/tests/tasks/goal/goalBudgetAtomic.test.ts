// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * **V5（Spec §6）：预算原子晋升 —— 并发下恰好一次收尾**（B2-5 / D4ⓑ，2026-09-23）。
 *
 * 被测语义（`goalBudget.chargeGoalUsage` + `TaskGoalStore.addUsageAndPromote`）：
 * 1. N 路并发记账、预算恰好临界 ⇒ **恰好 1 次** `statusChanged === true`；
 * 2. 触顶后继续记账 ⇒ `tokensUsed` **继续增长**，且收尾提示**不再重复**（幂等）；
 * 3. 事件面：`goal/status_changed` 恰好 1 条（"收尾只报一次"的落点）。
 *
 * **修复前必失败的取证（如实记录）**：见交付报告 —— 本用例对**旧两步法**
 * （`addUsage` → `updateStatus`）的实测结论。这里先把"恰好一次"固化为回归断言：
 * 任何把"判定与写入"重新拆成两步、或让 `promoted` 由陈旧读派生的实现，都会在这里翻红。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import type { LiriEvent } from '../../../src/chat/types/events';
import type { LiriEventMap } from '../../../src/chat/types/eventPayloads';
import { TaskGoalStore } from '../../../src/tasks/goal/TaskGoalStore';
import { chargeGoalUsage } from '../../../src/tasks/goal/goalBudget';
import { setGoalEventSink } from '../../../src/tasks/goal/GoalEvents';

const createdPaths: string[] = [];
const opened: TaskGoalStore[] = [];

function makeStore(): TaskGoalStore {
  const path = join(tmpdir(), `goal-atomic-${randomUUID().slice(0, 8)}.db`);
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

describe('V5：预算原子晋升（并发唯一 + 幂等 + 触顶后仍记账）', () => {
  test('N 路并发同目标（预算临界）⇒ 恰好 1 次 statusChanged；状态与用量一致', async () => {
    const store = makeStore();
    const goal = await store.create({
      objective: '并发触顶',
      sessionId: 'sess-atomic',
      tokenBudget: 100,
    });

    // 预算恰好临界：10 路 × 20 = 200，其中第 5 路之后必然越过 100
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        chargeGoalUsage({ goalId: goal.id, tokens: 20, store })
      )
    );

    const changed = results.filter((r) => r?.statusChanged === true);
    expect(changed).toHaveLength(1); // ← 恰好一次（并发窗口的防线）
    expect(results.every((r) => r !== null)).toBe(true);

    const after = await store.get(goal.id);
    expect(after?.status).toBe('budget_limited');
    expect(after?.tokensUsed).toBe(200); // 10 路全部如实入账（累加写）
    expect(after?.updatedReason).toBe('budget_limit');

    // 触顶后继续记账 ⇒ 用量仍增长、收尾不再重复
    const more = await chargeGoalUsage({ goalId: goal.id, tokens: 7, store });
    expect(more?.tokensUsed).toBe(207);
    expect(more?.exceeded).toBe(true);
    expect(more?.statusChanged).toBe(false);
    expect((await store.get(goal.id))?.status).toBe('budget_limited');
  });

  test('事件面：并发触顶只落 1 条 goal/status_changed（"收尾只报一次"）', async () => {
    const store = makeStore();
    const events = makeSink();
    const goal = await store.create({
      objective: '并发事件',
      sessionId: 'sess-atomic-events',
      tokenBudget: 50,
    });

    await Promise.all(
      Array.from({ length: 6 }, () =>
        chargeGoalUsage({ goalId: goal.id, tokens: 10, store })
      )
    );

    const statusChanged = events.filter(
      (e) => e.type === 'goal/status_changed'
    );
    expect(statusChanged).toHaveLength(1);
    const data = statusChanged[0].data as LiriEventMap['goal/status_changed'];
    expect(data.to).toBe('budget_limited');
    expect(data.reason).toBe('budget_limit');
    // 晋升时刻的累计值取决于并发交错（≥ 预算即可）⇒ 只断言"已达/超过预算"，不锁具体数
    expect(data.tokensUsed).toBeGreaterThanOrEqual(50);
    expect(data.tokenBudget).toBe(50);
  });

  test('幂等：已触顶目标再次记账 ⇒ tokensUsed 增长但 statusChanged 恒 false', async () => {
    const store = makeStore();
    const goal = await store.create({
      objective: '已触顶',
      sessionId: 'sess-atomic-idem',
      tokenBudget: 10,
    });

    const first = await chargeGoalUsage({ goalId: goal.id, tokens: 20, store });
    expect(first?.statusChanged).toBe(true);

    for (const tokens of [1, 2, 3]) {
      const r = await chargeGoalUsage({ goalId: goal.id, tokens, store });
      expect(r?.statusChanged).toBe(false);
    }
    expect((await store.get(goal.id))?.tokensUsed).toBe(26);
    expect((await store.get(goal.id))?.status).toBe('budget_limited');
  });
});
