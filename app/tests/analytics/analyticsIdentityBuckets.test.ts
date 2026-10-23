/**
 * 多租户 P3：分析服务的**内存累计**按身份分桶
 *
 * 背景：`/v1/analytics/dashboard` 直接读 `analyticsService` 的进程级内存态
 * （`getEvents()` / `getStats()` / `getToolCallStats()`）。改造前那是"全进程所有人"
 * 的埋点与工具调用计数 ⇒ 任一已登录用户都能看到别人的活动。
 *
 * 现口径：
 * - 写入侧：每条埋点带 `ownerKey`，工具调用计数按 `principalKeyOf` 分桶；
 * - 读侧：`getEvents` / `getStats` / `getToolCallStats` / `eventCounts` 只回当前身份；
 * - 本地身份恒 `local:local` 一个桶 ⇒ 桌面 / CLI / cron 读数与改造前逐字一致。
 */
import { describe, it, expect } from 'bun:test';

import { AnalyticsService } from '../../src/analytics/AnalyticsService.js';
import { runWithPrincipal } from '@modules/core/identity/requestScope.js';
import type { Principal } from '@modules/core/identity/principal.js';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'other', userId: 'bob', roles: ['user'] };

describe('AnalyticsService：读侧按身份裁剪', () => {
  it('工具调用计数不跨身份：A 的调用不出现在 B 的读数里', () => {
    const service = new AnalyticsService();

    service.trackEvent('tool_execute', 'local_tool', {
      tool_name: 'file_read',
    });
    runWithPrincipal(ALICE, () => {
      service.trackEvent('tool_execute', 'alice_tool', {
        tool_name: 'web_search',
      });
      service.trackEvent('tool_execute', 'alice_tool', {
        tool_name: 'web_search',
      });
    });

    const local = service.getToolCallStats();
    expect(local.totalCalls).toBe(1);
    expect(local.topTools).toEqual([{ name: 'file_read', count: 1 }]);

    const alice = runWithPrincipal(ALICE, () => service.getToolCallStats());
    expect(alice.totalCalls).toBe(2);
    expect(alice.uniqueTools).toBe(1);
    expect(alice.topTools).toEqual([{ name: 'web_search', count: 2 }]);

    const bob = runWithPrincipal(BOB, () => service.getToolCallStats());
    expect(bob.totalCalls).toBe(0);
    expect(bob.topTools).toEqual([]);
  });

  it('埋点列表 / getStats / eventCounts 只回当前身份', () => {
    const service = new AnalyticsService();

    service.trackEvent('error', 'local_error');
    runWithPrincipal(ALICE, () => {
      service.trackEvent('error', 'alice_error');
      service.trackEvent('llm_request', 'alice_llm');
    });

    const localEvents = service.getEvents();
    expect(localEvents.map((e) => e.name)).toEqual(['local_error']);

    const aliceEvents = runWithPrincipal(ALICE, () => service.getEvents());
    expect(aliceEvents.map((e) => e.name)).toEqual([
      'alice_error',
      'alice_llm',
    ]);

    expect(service.getStats().totalEvents).toBe(1);
    expect(service.getStats().totalToolCalls).toBe(0);
    expect(runWithPrincipal(ALICE, () => service.getStats().totalEvents)).toBe(
      2
    );

    // 类型维度计数同样按身份
    expect(service.eventCounts).toEqual({ error: 1 });
    expect(runWithPrincipal(ALICE, () => service.eventCounts)).toEqual({
      error: 1,
      llm_request: 1,
    });
  });

  it('本地身份仍是单桶（同一桶内累加，与改造前等价）', () => {
    const service = new AnalyticsService();

    service.trackEvent('tool_call', 'a', { tool_name: 'file_write' });
    service.trackEvent('tool_call', 'a', { tool_name: 'file_write' });
    service.trackEvent('tool_call', 'b', { tool_name: 'shell' });

    const stats = service.getToolCallStats();
    expect(stats.totalCalls).toBe(3);
    expect(stats.uniqueTools).toBe(2);
    expect(stats.topTools).toEqual([
      { name: 'file_write', count: 2 },
      { name: 'shell', count: 1 },
    ]);
  });
});
