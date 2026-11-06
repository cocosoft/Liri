/**
 * N-12 后续（2026-11-06）：chunk 间等待的**心跳切片**回归锁。
 *
 * 原实现是一次 `sleep(120s)` 的静默竞速 —— 真机停滞时这段时间既无日志也无提示。
 * 现口径：按 `heartbeatMs` 切片，每片回调一次心跳（已等待/剩余）；到点抛
 * `STREAM_IDLE_TIMEOUT`（错误文案由调用方给定）。
 */
import { describe, expect, it } from 'bun:test';
import { awaitNextChunkWithHeartbeat } from '../../../src/chat/orchestrator/chunkIdleWait';

describe('awaitNextChunkWithHeartbeat（N-12 后续）', () => {
  it('chunk 及时到达 ⇒ 直接返回，不触发心跳', async () => {
    const beats: Array<{ waitedMs: number; remainingMs: number }> = [];
    const value = await awaitNextChunkWithHeartbeat({
      next: Promise.resolve('chunk'),
      timeoutMs: 100,
      heartbeatMs: 10,
      timeoutMessage: '不应触发',
      onHeartbeat: (info) => beats.push(info),
    });
    expect(value).toBe('chunk');
    expect(beats).toHaveLength(0);
  });

  it('停滞期间按心跳间隔留痕，超预算抛 STREAM_IDLE_TIMEOUT', async () => {
    const beats: Array<{ waitedMs: number; remainingMs: number }> = [];
    const never = new Promise<string>(() => {});
    const startedAt = Date.now();
    const error = await awaitNextChunkWithHeartbeat({
      next: never,
      timeoutMs: 60,
      heartbeatMs: 20,
      timeoutMessage: '停滞测试',
      onHeartbeat: (info) => beats.push(info),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: string }).code).toBe('STREAM_IDLE_TIMEOUT');
    expect((error as Error).message).toBe('停滞测试');
    // 至少两片心跳（20s/40s 两个切片），且确实等满了预算才抛错
    expect(beats.length).toBeGreaterThanOrEqual(2);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(60);
    // 剩余预算随心跳递减（排查时可直接读"还剩多久"）
    expect(beats[beats.length - 1].remainingMs).toBeLessThanOrEqual(
      beats[0].remainingMs
    );
    expect(beats[0].waitedMs).toBeGreaterThanOrEqual(15);
  });
});
