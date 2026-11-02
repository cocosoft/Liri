/**
 * P36-b-4 · queue 判定的有界等待（2026-11-02）
 *
 * 覆盖：
 * ① 空闲 ⇒ 首次即 admitted（attempts=0，零开销）；
 * ② 被持有 → 交还后下一轮拿到 ⇒ admitted，且已释放排队尝试；
 * ③ 一直持有 ⇒ 超时 `admitted=false`（调用方据此如实拒绝，而不是并发启动）；
 * ④ 第 n 轮才拿到 ⇒ attempts 如实计数（可观察等待次数，便于排障）；
 * ⑤ 与 ExecutionManager 的 `isCurrent` 语义一致（不会出现两个 RUNNING）。
 */
import { describe, expect, it } from 'bun:test';

import {
  ExecutionManager,
  waitForOwnership,
} from '@openliri/service/execution';

const noSleep = async (): Promise<void> => {};

describe('P36-b-4: waitForOwnership', () => {
  it('空闲 ⇒ 首次即拿到（attempts=0）', async () => {
    const manager = new ExecutionManager();
    const lease = manager.acquire('s1', 'm1');
    const result = await waitForOwnership(
      () => manager.acquire('s1', 'm1'),
      { waitMs: 1000, pollMs: 1, sleep: noSleep },
      lease
    );
    expect(result.admitted).toBe(true);
    expect(result.attempts).toBe(0);
    expect(result.lease.isCurrent()).toBe(true);
  });

  it('持有者交还后下一轮拿到 ⇒ admitted=true，attempts≥1', async () => {
    const manager = new ExecutionManager();
    const owner = manager.acquire('s1', 'owner-turn', 'w-1');
    const queued = manager.acquire('s1', 'human-1');
    expect(queued.isCurrent()).toBe(false);

    // 人喊停并确认 ⇒ 所有权释放（与生产同一路径）
    manager.requestCancel(owner.executionId, 'user_stop');
    manager.confirmCancel(owner.executionId);

    const result = await waitForOwnership(
      () => manager.acquire('s1', 'human-1'),
      { waitMs: 1000, pollMs: 1, sleep: noSleep },
      queued
    );
    expect(result.admitted).toBe(true);
    expect(result.attempts).toBeGreaterThanOrEqual(1);
    expect(result.lease.isCurrent()).toBe(true);
  });

  it('一直持有 ⇒ 超时 admitted=false（返回的租约由调用方 release）', async () => {
    const manager = new ExecutionManager();
    manager.acquire('s1', 'owner-turn', 'w-1');
    const queued = manager.acquire('s1', 'human-1');

    const result = await waitForOwnership(
      () => manager.acquire('s1', 'human-1'),
      { waitMs: 0, pollMs: 1, sleep: noSleep },
      queued
    );
    expect(result.admitted).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.lease.isCurrent()).toBe(false);
    result.lease.release();
    // 仍未越权：会话只有一个持有者
    expect(manager.getBySession('s1')?.messageId).toBe('owner-turn');
  });

  it('第 n 轮才交还 ⇒ attempts 如实计数', async () => {
    const manager = new ExecutionManager();
    const owner = manager.acquire('s1', 'owner-turn', 'w-1');
    const queued = manager.acquire('s1', 'human-1');
    let releases = 0;

    const result = await waitForOwnership(
      () => {
        releases += 1;
        if (releases === 3) {
          // 第三轮才真正交还（两段式取消：先请求、再确认）
          manager.requestCancel(owner.executionId, 'user_stop');
          manager.confirmCancel(owner.executionId);
        }
        return manager.acquire('s1', 'human-1');
      },
      { waitMs: 5000, pollMs: 1, sleep: noSleep },
      queued
    );

    expect(result.admitted).toBe(true);
    expect(result.attempts).toBe(3);
  });
});
