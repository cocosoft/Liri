/**
 * X11 / V18（2026-10-05）：批次启动 ⇒ 目标**自动创建**
 * （`.trae/specs/goal-entity.md` §11.1）。
 *
 * 锁定四条语义（"修复前必失败"：`ensureGoalForBatch` 不存在 ⇒ 本文件全部用例失败）：
 * - `sessionId` 缺失 ⇒ `null` 且**不建行**（零副作用）；
 * - 无未终结目标 ⇒ 建行 + `goal/created` 事件（**断言库内事实**，不 mock 内部调用）；
 * - 已有未终结目标（`active` / `blocked`）⇒ `null` 且**行数不变**（幂等，守"一会话一目标"）；
 * - 仅终态目标存在 ⇒ **仍可建新目标**（`listActive` 不含终态）。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import type { LiriEvent } from '@modules/session/types/events';
import type { LiriEventMap } from '@modules/session/types/eventPayloads';
import {
  TaskGoalStore,
  setTaskGoalStoreForTest,
} from '../../../src/tasks/goal/TaskGoalStore';
import { ensureGoalForBatch } from '../../../src/tasks/goal/goalRunBinding';
import { setGoalEventSink } from '../../../src/tasks/goal/GoalEvents';

const createdPaths: string[] = [];
const opened: TaskGoalStore[] = [];

function makeStore(): TaskGoalStore {
  const path = join(tmpdir(), `goal-autocreate-${randomUUID().slice(0, 8)}.db`);
  createdPaths.push(path);
  const store = new TaskGoalStore(path);
  opened.push(store);
  return store;
}

/** 内存追加器（只模拟 seq 分配；与 `goalRunBinding.test.ts` 同法） */
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

function createdPayloads(events: LiriEvent[]): LiriEventMap['goal/created'][] {
  return events
    .filter((e) => e.type === 'goal/created')
    .map((e) => e.data as LiriEventMap['goal/created']);
}

afterEach(() => {
  setGoalEventSink(null);
  setTaskGoalStoreForTest(null);
  while (opened.length > 0) opened.pop()!.close();
  while (createdPaths.length > 0) {
    try {
      unlinkSync(createdPaths.pop()!);
    } catch {
      // @ignore-catch — 清理临时文件失败不影响断言
    }
  }
});

describe('ensureGoalForBatch：swarm 批次启动的目标自动创建', () => {
  test('sessionId 缺失 ⇒ null 且不建行（零副作用）', async () => {
    const store = makeStore();
    const events = makeSink();

    const goal = await ensureGoalForBatch({ objective: '实现 X', store });

    expect(goal).toBeNull();
    expect(await store.listBySession('s-1')).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  test('无未终结目标 ⇒ 建行 + goal/created 事件', async () => {
    const store = makeStore();
    const events = makeSink();

    const goal = await ensureGoalForBatch({
      sessionId: 's-1',
      objective: '实现 X',
      store,
    });

    expect(goal).not.toBeNull();
    expect(goal!.sessionId).toBe('s-1');
    expect(goal!.objective).toBe('实现 X');
    expect(goal!.status).toBe('active');

    // 断言库内事实（不 mock 内部调用）
    const rows = await store.listBySession('s-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(goal!.id);

    const created = createdPayloads(events);
    expect(created).toHaveLength(1);
    expect(created[0].goalId).toBe(goal!.id);
    expect(created[0].objective).toBe('实现 X');
    expect(created[0].sessionId).toBe('s-1');
  });

  test('已有未终结目标（active）⇒ null 且行数不变（幂等）', async () => {
    const store = makeStore();
    const events = makeSink();
    await store.create({ objective: '原目标', sessionId: 's-1' });

    const goal = await ensureGoalForBatch({
      sessionId: 's-1',
      objective: '新目标',
      store,
    });

    expect(goal).toBeNull();
    const rows = await store.listBySession('s-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].objective).toBe('原目标');
    expect(events).toHaveLength(0);
  });

  test('blocked（非终态）也算已有未终结目标 ⇒ 不新建', async () => {
    const store = makeStore();
    const events = makeSink();
    const existing = await store.create({
      objective: '原目标',
      sessionId: 's-1',
    });
    await store.markStatusChanged(existing.id, 'blocked', 'batch_blocked');

    const goal = await ensureGoalForBatch({
      sessionId: 's-1',
      objective: '新目标',
      store,
    });

    expect(goal).toBeNull();
    expect(await store.listBySession('s-1')).toHaveLength(1);
    expect(events).toHaveLength(0);
  });

  test('仅终态目标存在 ⇒ 仍可建新目标（listActive 不含终态）', async () => {
    const store = makeStore();
    const events = makeSink();
    const done = await store.create({
      objective: '已完成目标',
      sessionId: 's-1',
    });
    await store.markStatusChanged(done.id, 'completed', 'batch_completed');

    const goal = await ensureGoalForBatch({
      sessionId: 's-1',
      objective: '新目标',
      store,
    });

    expect(goal).not.toBeNull();
    expect(goal!.objective).toBe('新目标');
    const rows = await store.listBySession('s-1');
    expect(rows).toHaveLength(2);
    expect(createdPayloads(events)).toHaveLength(1);
  });

  test('缺省 store 走全局单例（setTaskGoalStoreForTest 测试缝）', async () => {
    const store = makeStore();
    setTaskGoalStoreForTest(store);
    const events = makeSink();

    const goal = await ensureGoalForBatch({
      sessionId: 's-2',
      objective: '经单例创建',
    });

    expect(goal).not.toBeNull();
    expect(await store.listBySession('s-2')).toHaveLength(1);
    expect(createdPayloads(events)).toHaveLength(1);
  });
});
