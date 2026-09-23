/**
 * B1-3（P0-2）：yield **等待集持久化** —— 落盘点 / 启动重建 / 真实存储往返。
 *
 * 修复前：`SettlementOutbox` 只持久化"结算信号"，没持久化"**谁在等**"
 *（`YieldRegistry` 纯内存）⇒ 重启后回放 `registry.get() = undefined` ⇒ 逐次
 * `markFailed` ⇒ 8 次后 `dropped`：O8 的崩溃恢复能力**结构性不成立**。
 *
 * 本文件锁定：
 * - 落盘**四处**：`register` / `updateTurn` / `resolve|abandon` / `clear`；
 * - `restore()` **不**触发再次落盘（重建是只读动作）；
 * - 重建后 **`turn` 不为 0**（只落 register 不落 updateTurn 会让 `isSuperseded` 恒 false
 *   ⇒ B1-1 防的"重复恢复"从后门回来 —— 方案 §14.2 洞①）；
 * - 已收敛（resolved/abandoned）的等待**不会**在重建时复活。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import { YieldRegistry, rebuildYieldWaitingSet } from '../../src/session/yield';
import {
  YieldWaitingStore,
  type YieldWaitingPersistence,
  type YieldWaitingRecord,
} from '../../src/session/yield/YieldWaitingStore';

/** 记录调用的假端口（不触盘） */
class FakePort implements YieldWaitingPersistence {
  saved: YieldWaitingRecord[] = [];
  removed: string[] = [];
  cleared = 0;

  save(record: YieldWaitingRecord): void {
    this.saved.push(record);
  }
  remove(sessionId: string): void {
    this.removed.push(sessionId);
  }
  clearAll(): void {
    this.cleared += 1;
  }
}

describe('B1-3：落盘点（可注入端口）', () => {
  test('register / updateTurn 落盘、resolve 删除、clear 清空', () => {
    const port = new FakePort();
    const registry = new YieldRegistry();
    registry.setPersistence(port);

    const entry = registry.register({
      sessionId: 's1',
      turn: 0,
      toolCallId: 'c1',
      yieldedAt: 100,
    });
    expect(port.saved).toHaveLength(1);
    expect(port.saved[0]).toEqual({
      sessionId: 's1',
      turn: 0,
      toolCallId: 'c1',
      yieldedAt: 100,
    });

    expect(registry.updateTurn('s1', 7, entry)).toBe(true);
    expect(port.saved).toHaveLength(2);
    expect(port.saved[1].turn).toBe(7); // 洞①：turn 必须落盘

    expect(registry.resolve('s1', 'resumed', entry)).toBe(true);
    expect(port.removed).toEqual(['s1']); // 终态 ⇒ 删除持久化行（防重建复活）

    registry.clear();
    expect(port.cleared).toBe(1);
  });

  test('restore 是只读重建：不触发再次落盘', () => {
    const port = new FakePort();
    const registry = new YieldRegistry();
    registry.setPersistence(port);

    registry.restore({
      sessionId: 's2',
      turn: 9,
      toolCallId: 'c9',
      yieldedAt: 500,
    });

    expect(registry.isWaiting('s2')).toBe(true);
    expect(registry.get('s2')?.turn).toBe(9);
    expect(port.saved).toHaveLength(0);
  });

  test('未装配端口 ⇒ 纯内存（与修复前行为一致）', () => {
    const registry = new YieldRegistry();
    expect(() =>
      registry.register({ sessionId: 's3', turn: 1, toolCallId: 'c3' })
    ).not.toThrow();
    expect(registry.isWaiting('s3')).toBe(true);
    registry.clear();
  });
});

describe('B1-3：真实存储往返与启动重建', () => {
  const createdPaths: string[] = [];
  const opened: YieldWaitingStore[] = [];

  function makeStore(): YieldWaitingStore {
    const path = join(tmpdir(), `yield-wait-${randomUUID().slice(0, 8)}.db`);
    createdPaths.push(path);
    const store = new YieldWaitingStore(path);
    opened.push(store);
    return store;
  }

  beforeEach(() => {
    // 本组只用显式路径的 store 实例，不触碰全局单例
  });

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

  test('saveRecord 为 upsert（同会话覆盖，与内存口径一致）', async () => {
    const store = makeStore();
    await store.saveRecord({
      sessionId: 's1',
      turn: 0,
      toolCallId: 'c1',
      yieldedAt: 100,
    });
    await store.saveRecord({
      sessionId: 's1',
      turn: 7,
      toolCallId: 'c1',
      yieldedAt: 100,
    });

    const rows = await store.loadAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].turn).toBe(7);
  });

  test('**崩溃重建**：register + updateTurn（落盘）⇒ 新实例重建后 turn ≠ 0', async () => {
    const store = makeStore();
    const first = new YieldRegistry();
    first.setPersistence(store);

    const entry = first.register({
      sessionId: 's1',
      turn: 0,
      toolCallId: 'c1',
      yieldedAt: 100,
    });
    first.updateTurn('s1', 5, entry);
    // 等 fire-and-forget 落盘完成
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 进程重启：新的 registry 实例 + 重建
    const restarted = new YieldRegistry();
    const restored = await rebuildYieldWaitingSet(store, restarted);

    expect(restored).toBe(1);
    expect(restarted.isWaiting('s1')).toBe(true);
    // 修复前（等待集不落盘）此处为 0 条；只落 register 不落 updateTurn 则 turn=0
    expect(restarted.get('s1')?.turn).toBe(5);
    expect(restarted.get('s1')?.toolCallId).toBe('c1');
  });

  test('已收敛的等待不会在重建时复活', async () => {
    const store = makeStore();
    const first = new YieldRegistry();
    first.setPersistence(store);

    const entry = first.register({
      sessionId: 's1',
      turn: 3,
      toolCallId: 'c1',
      yieldedAt: 100,
    });
    first.resolve('s1', 'resumed', entry);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const restarted = new YieldRegistry();
    expect(await rebuildYieldWaitingSet(store, restarted)).toBe(0);
    expect(restarted.isWaiting('s1')).toBe(false);
  });

  test('clearRecords 清空全部等待行', async () => {
    const store = makeStore();
    await store.saveRecord({
      sessionId: 's1',
      turn: 1,
      toolCallId: 'c1',
      yieldedAt: 1,
    });
    await store.saveRecord({
      sessionId: 's2',
      turn: 2,
      toolCallId: 'c2',
      yieldedAt: 2,
    });
    expect(await store.loadAll()).toHaveLength(2);

    await store.clearRecords();
    expect(await store.loadAll()).toHaveLength(0);
  });
});
