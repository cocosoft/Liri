/**
 * 多租户 P5：删租户时丢弃**分析服务**的内存累计
 *
 * 缺口：`AnalyticsService` 的工具调用桶与埋点队列都是进程内累计（按 `ownerKey` 分桶）。
 * 删租户后它们仍留在进程里 ⇒ 同名新租户一上来就带着"上一世"的读数（`/v1/analytics/dashboard`
 * 与 `getToolCallStats()` 都是读这里）。
 *
 * 本文件锁三件事：① 前缀隔离（别的租户与本地桶不受影响）；② 埋点队列同样按租户过滤；
 * ③ `purgeTenant` 真的调用它（计数进 `removed.scopedCaches`）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  AnalyticsService,
  analyticsService,
} from '../../src/analytics/AnalyticsService.js';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';
import type { Principal } from '@openliri/kernel/identity/principal.js';
import { setUserDataDirOverride } from '@modules/environment';
import { purgeTenant } from '../../src/runtime/tenantPurge.js';

const A: Principal = {
  tenantId: 'analytics-ten-a',
  userId: 'alice',
  roles: [],
};
const B: Principal = {
  tenantId: 'analytics-ten-b',
  userId: 'alice',
  roles: [],
};

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-analytics-forget-'));
  setUserDataDirOverride(root);
});

afterEach(() => {
  setUserDataDirOverride(null);
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // @ignore-catch — Windows 句柄可能延迟释放，清理失败不影响断言
  }
});

describe('AnalyticsService.forgetForTenant', () => {
  it('只清目标租户的工具桶与埋点（其他租户不受影响，且幂等）', () => {
    const service = new AnalyticsService();
    runWithPrincipal(A, () =>
      service.trackEvent('tool_execute', 'a_tool', { tool_name: 'web_search' })
    );
    runWithPrincipal(B, () =>
      service.trackEvent('tool_execute', 'b_tool', { tool_name: 'web_search' })
    );
    service.trackEvent('tool_execute', 'local_tool', {
      tool_name: 'file_read',
    });

    expect(service.forgetForTenant('analytics-ten-a')).toBe(1);

    expect(
      runWithPrincipal(A, () => service.getToolCallStats()).totalCalls
    ).toBe(0);
    expect(runWithPrincipal(A, () => service.getEvents())).toEqual([]);

    // B 与本地都未受影响
    expect(
      runWithPrincipal(B, () => service.getToolCallStats()).totalCalls
    ).toBe(1);
    expect(runWithPrincipal(B, () => service.getEvents()).length).toBe(1);
    expect(service.getToolCallStats().totalCalls).toBe(1);

    // 幂等：已摘过的前缀再摘为 0
    expect(service.forgetForTenant('analytics-ten-a')).toBe(0);
  });
});

describe('purgeTenant：分析累计接线', () => {
  it('删租户后埋点与工具桶清空，丢弃数进 scopedCaches', async () => {
    const tenantId = 'analytics-purge';
    const principal: Principal = { tenantId, userId: 'alice', roles: [] };
    runWithPrincipal(principal, () => {
      analyticsService.trackEvent('tool_execute', 'purge_tool', {
        tool_name: 'file_read',
      });
      analyticsService.trackEvent('error', 'purge_error');
    });

    const report = await purgeTenant(tenantId);

    expect(report.removed.scopedCaches).toBe(1);
    expect(
      runWithPrincipal(principal, () => analyticsService.getEvents())
    ).toEqual([]);
    expect(
      runWithPrincipal(principal, () => analyticsService.getToolCallStats())
        .totalCalls
    ).toBe(0);
  });
});
