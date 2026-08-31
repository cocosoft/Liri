/**
 * HeartbeatManager 任务租约测试（P1-5，对标 Hermes kanban claim_lock/claim_expires）
 *
 * 覆盖：
 * - register 带 owner → 租约认领，getOwner 返回持有者
 * - beat 续租：持有者成功，非持有者被拒绝（防多进程抢占）
 * - forceClaim：租约未过期拒绝抢占，过期后可抢占
 * - isLeaseValid：有效/过期判定
 */
import { describe, test, expect } from 'bun:test';
import { HeartbeatManager } from '../../../src/tasks/heartbeat/HeartbeatManager';

function withExpiredLease(mgr: HeartbeatManager, taskId: string): void {
  const record = mgr.getRecord(taskId)!;
  record.lastHeartbeatAt -= record.ttlMs + 1000; // 强制过期
}

describe('HeartbeatManager 任务租约（P1-5）', () => {
  test('register 带 owner：租约认领 + getOwner 返回持有者', () => {
    const mgr = new HeartbeatManager({ defaultTtlMs: 60_000 });
    mgr.register('task-1', { ttlMs: 60_000, owner: 'worker-a' });
    expect(mgr.getOwner('task-1')).toBe('worker-a');
    expect(mgr.isLeaseValid('task-1')).toBe(true);
  });

  test('beat 续租：持有者成功，非持有者被拒绝', () => {
    const mgr = new HeartbeatManager({ defaultTtlMs: 60_000 });
    mgr.register('task-1', { ttlMs: 60_000, owner: 'worker-a' });
    expect(mgr.beat('task-1', 'worker-a')).toBe(true); // 持有者续租
    expect(mgr.beat('task-1', 'worker-b')).toBe(false); // 非持有者被拒
  });

  test('forceClaim：租约未过期拒绝抢占', () => {
    const mgr = new HeartbeatManager({ defaultTtlMs: 60_000 });
    mgr.register('task-1', { ttlMs: 60_000, owner: 'worker-a' });
    expect(mgr.forceClaim('task-1', 'worker-b')).toBe(false); // 未过期
    expect(mgr.getOwner('task-1')).toBe('worker-a');
  });

  test('forceClaim：租约过期后可抢占（对标 claim_expires）', () => {
    const mgr = new HeartbeatManager({ defaultTtlMs: 60_000 });
    mgr.register('task-1', { ttlMs: 60_000, owner: 'worker-a' });
    withExpiredLease(mgr, 'task-1');
    expect(mgr.isLeaseValid('task-1')).toBe(false);
    expect(mgr.forceClaim('task-1', 'worker-b', 60_000)).toBe(true);
    expect(mgr.getOwner('task-1')).toBe('worker-b');
    expect(mgr.isLeaseValid('task-1')).toBe(true);
  });

  test('getStaleTasks / detectTimeout 不受租约影响（心跳超时语义保留）', () => {
    const mgr = new HeartbeatManager({ defaultTtlMs: 60_000 });
    mgr.register('task-1', { ttlMs: 60_000, owner: 'worker-a' });
    withExpiredLease(mgr, 'task-1');
    expect(mgr.getStaleTasks()).toContain('task-1'); // 心跳超时仍检测
  });
});
