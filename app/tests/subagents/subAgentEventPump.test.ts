/**
 * N-70（2026-09-25）：`SubAgentEventPump` 心跳语义修复的回归锁。
 *
 * 实测背景：单次 swarm 刷出 **65 条** `pump:stale`；`lastHeartbeat` 全程在推进
 * （间隔 4–11s）⇒ 根因是**阈值被误设为轮询间隔（2s）** + `detectStale` **改写 `status`**。
 *
 * 修复口径：① 阈值与轮询间隔解耦（默认 60s）；② `status` 只由 heartbeat/complete/fail 驱动
 * （detectStale 只读判定）；③ 同一子代理**仅首次告警**（心跳恢复后重置）。
 *
 * 采集方式：`setOnStatusChange` 回调（**不使用 mock.module** —— 进程级替换会跨文件泄漏）。
 */
import { describe, test, expect } from 'bun:test';
import {
  SubAgentEventPump,
  SUBAGENT_HEARTBEAT_TIMEOUT_MS,
  type SubAgentStatusEvent,
} from '../../src/subagents/SubAgentEventPump';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 直接调用私有检测（不启动定时器 ⇒ 测试可控且快） */
const detect = (pump: SubAgentEventPump): void =>
  (pump as unknown as { detectStale(): void }).detectStale();

function makePump(timeoutMs: number): {
  pump: SubAgentEventPump;
  events: SubAgentStatusEvent[];
} {
  const pump = new SubAgentEventPump(10_000, timeoutMs);
  const events: SubAgentStatusEvent[] = [];
  pump.setOnStatusChange((e) => events.push(e));
  return { pump, events };
}

describe('N-70 SubAgentEventPump 心跳语义', () => {
  test('默认阈值与轮询间隔解耦（60s，而非原 2s）', () => {
    expect(SUBAGENT_HEARTBEAT_TIMEOUT_MS).toBe(60_000);
    const pump = new SubAgentEventPump();
    // 轮询间隔仍是 500ms（与阈值不同量级）
    expect((pump as unknown as { pollIntervalMs: number }).pollIntervalMs).toBe(
      500
    );
  });

  test('超时 ⇒ 发 stale 观测事件，但**不改写 status**（修复前会被写成 stale）', async () => {
    const { pump, events } = makePump(30);
    pump.register('a1');
    pump.heartbeat('a1');
    await sleep(60);

    detect(pump);

    // 修复前：status 被改成 'stale' ⇒ 本条必失败
    expect(pump.getState('a1')?.status).toBe('running');
    expect(events.filter((e) => e.stale === true)).toHaveLength(1);
  });

  test('同一子代理连续检测**只告警一次**（修复前实测刷 65 条）', async () => {
    const { pump, events } = makePump(30);
    pump.register('a1');
    pump.heartbeat('a1');
    await sleep(60);

    detect(pump);
    detect(pump);
    detect(pump);

    expect(events.filter((e) => e.stale === true)).toHaveLength(1);
  });

  test('心跳恢复后再次超时 ⇒ 可再次告警（标记已清除）', async () => {
    const { pump, events } = makePump(30);
    pump.register('a1');
    pump.heartbeat('a1');
    await sleep(60);
    detect(pump);

    pump.heartbeat('a1'); // 恢复
    await sleep(60);
    detect(pump);

    expect(events.filter((e) => e.stale === true)).toHaveLength(2);
  });

  test('未超阈值时不告警', async () => {
    const { pump, events } = makePump(5_000);
    pump.register('a1');
    pump.heartbeat('a1');
    await sleep(20);

    detect(pump);

    expect(events.filter((e) => e.stale === true)).toHaveLength(0);
  });

  test('completed / failed 后不再告警（非 running 直接跳过）', async () => {
    const { pump, events } = makePump(30);
    pump.register('a1');
    pump.heartbeat('a1');
    pump.complete('a1');
    await sleep(60);
    detect(pump);

    expect(events.filter((e) => e.stale === true)).toHaveLength(0);
    expect(pump.getState('a1')?.status).toBe('completed');
  });
});
