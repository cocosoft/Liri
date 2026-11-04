// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2-1（2026-11-04，《运行态问题排查与修复方案》）：**provider 逐请求延迟日志**的分级。
 *
 * 真机窗口（`since=2026-11-04T04:00Z`）：
 * - `provider 请求完成（TTFB）` 1 543 条（p50 371ms / p95 1 366ms）
 * - `provider 流式完成` 1 540 条（p50 2.2s / p95 5.6s）
 * - `provider 聊天完成` 5 125 条（p50 2.4s / p95 16.9s）
 *
 * 口径：**慢尾 / 失败仍 INFO**（排查要看的就是这些），常态走 debug；
 * 延迟的统计事实面另有 `metric/timing` 事件。
 */
import { describe, it, expect, spyOn, afterEach } from 'bun:test';
import { getLogger } from '@openliri/infra/monitoring/logs/Logger';
import { shouldLogLatencyAtInfo } from '../../src/ai/providers/providerLatencyNotice';
import { BaseAIProvider } from '../../src/ai/providers/BaseAIProvider';

describe('P2-1：shouldLogLatencyAtInfo（慢尾/失败才 INFO）', () => {
  it('快且成功 ⇒ 不进 INFO', () => {
    expect(shouldLogLatencyAtInfo(300, 2000, true)).toBe(false);
    expect(shouldLogLatencyAtInfo(1999, 2000)).toBe(false);
  });

  it('达到阈值（含边界）⇒ INFO', () => {
    expect(shouldLogLatencyAtInfo(2000, 2000)).toBe(true);
    expect(shouldLogLatencyAtInfo(16_869, 15_000)).toBe(true);
  });

  it('**失败**无论快慢 ⇒ INFO（非 2xx 必须可见）', () => {
    expect(shouldLogLatencyAtInfo(10, 2000, false)).toBe(true);
    expect(shouldLogLatencyAtInfo(0, 15_000, false)).toBe(true);
  });
});

describe('P2-1：measureChat 接线（快请求只进 debug）', () => {
  let infoSpy: ReturnType<typeof spyOn>;
  let debugSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    infoSpy?.mockRestore();
    debugSpy?.mockRestore();
  });

  it('快速完成的非流请求 ⇒ INFO 不再出现「provider 聊天完成」，debug 有一条', async () => {
    const seam = BaseAIProvider as unknown as {
      measureChat<T>(label: string, fn: () => Promise<T>): Promise<T>;
    };
    const logger = getLogger('ai:baseProvider');
    infoSpy = spyOn(logger, 'info');
    debugSpy = spyOn(logger, 'debug');

    const result = await seam.measureChat('test-fast', async () => 'ok');

    expect(result).toBe('ok');
    const infos = (infoSpy.mock.calls as unknown[][]).filter(
      (c) => c[0] === 'provider 聊天完成'
    );
    const debugs = (debugSpy.mock.calls as unknown[][]).filter(
      (c) => c[0] === 'provider 聊天完成'
    );
    expect(infos.length).toBe(0);
    expect(debugs.length).toBe(1);
    expect((debugs[0][1] as { provider: string }).provider).toBe('test-fast');
  });
});
