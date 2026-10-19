/**
 * ProcessRegistry 生命周期闭环（N4，2026-10-19）
 *
 * 覆盖三条此前缺失的不变量：
 * - 终态收敛后 active 归零（`isIdle()`）；
 * - PID 复用时不留下"永远 running"的僵尸条目；
 * - `trim()` 只淘汰终态，运行中进程不会被统计压力挤掉；`pruneTerminal()` 有界回收历史。
 */
import { describe, expect, it } from 'bun:test';
import { ProcessRegistry } from '../../src/sandbox/ProcessRegistry';

describe('ProcessRegistry 生命周期闭环', () => {
  it('终态收敛后 active 归零', () => {
    const registry = new ProcessRegistry();
    const id = registry.register({
      pid: 1001,
      command: 'bash',
      status: 'running',
    });

    expect(registry.getActiveCount()).toBe(1);
    expect(registry.isIdle()).toBe(false);

    expect(registry.complete(id, 'completed', 0)).toBe(true);
    expect(registry.getActiveCount()).toBe(0);
    expect(registry.isIdle()).toBe(true);
    expect(registry.getStats()).toMatchObject({
      total: 1,
      running: 0,
      completed: 1,
    });
    expect(registry.getProcess(id)?.completedAt).toBeGreaterThan(0);
  });

  it('PID 复用：旧 running 条目标记为 error，不虚增 active', () => {
    const registry = new ProcessRegistry();
    const oldId = registry.register({
      pid: 2002,
      command: 'old-process',
      status: 'running',
    });

    const newId = registry.register({
      pid: 2002,
      command: 'new-process',
      status: 'running',
    });

    const oldProc = registry.getProcess(oldId);
    expect(oldProc?.status).toBe('error');
    expect(oldProc?.metadata?.['supersededByPidReuse']).toBe(true);
    expect(registry.getActiveCount()).toBe(1);
    expect(registry.getProcess(newId)?.status).toBe('running');
  });

  it('trim 不淘汰运行中条目', () => {
    const registry = new ProcessRegistry(3);
    registry.register({ pid: 3001, command: 'a', status: 'running' });
    registry.register({ pid: 3002, command: 'b', status: 'running' });
    registry.register({ pid: 3003, command: 'c', status: 'running' });

    // 达到上限后注册第 4 条 ⇒ trim 无终态可删，必须保留全部 running
    registry.register({ pid: 3004, command: 'd', status: 'running' });

    expect(registry.getActiveCount()).toBe(4);
    expect(
      registry
        .query({ status: 'running' })
        .map((p) => p.pid)
        .sort()
    ).toEqual([3001, 3002, 3003, 3004]);
  });

  it('trim 优先淘汰最旧的终态条目', () => {
    const registry = new ProcessRegistry(100);
    const doneId = registry.register({
      pid: 4001,
      command: 'done',
      status: 'running',
    });
    registry.complete(doneId, 'completed', 0);
    registry.register({ pid: 4002, command: 'live', status: 'running' });

    registry.trim();

    expect(registry.getProcess(doneId)).toBeUndefined();
    expect(registry.getActiveCount()).toBe(1);
  });

  it('pruneTerminal 只回收过期终态，保留运行中与新鲜终态', async () => {
    const registry = new ProcessRegistry();
    const oldDone = registry.register({
      pid: 5001,
      command: 'old-done',
      status: 'running',
    });
    registry.complete(oldDone, 'completed', 0);

    const live = registry.register({
      pid: 5002,
      command: 'live',
      status: 'running',
    });

    // 让旧终态的 completedAt 落到 TTL 之外
    await new Promise((r) => setTimeout(r, 15));
    const removed = registry.pruneTerminal(10);

    expect(removed).toBe(1);
    expect(registry.getProcess(oldDone)).toBeUndefined();
    expect(registry.getProcess(live)?.status).toBe('running');
  });

  it('未知 id 收敛返回 false（不制造条目）', () => {
    const registry = new ProcessRegistry();
    expect(registry.complete('missing', 'completed', 0)).toBe(false);
    expect(registry.getStats().total).toBe(0);
  });
});
