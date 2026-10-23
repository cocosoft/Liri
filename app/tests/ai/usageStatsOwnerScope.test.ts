/**
 * 多租户 P5：用量/技能使用统计的**读取侧**按身份过滤
 *
 * ① 已认证身份只能看到自己的行（`owner_key = '<tenant>:<user>'`）；
 * ② 本地/后台（无归属）不过滤 ⇒ 宿主/运维仍看全库，与改造前一致；
 * ③ 历史/本地行（`owner_key IS NULL`）对已认证身份**不可见**（fail-closed）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  setUserDataDirOverride,
  resolveDataDir,
  resolveDbPath,
} from '@openliri/kernel/paths.js';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';
import type { Principal } from '@openliri/kernel/identity/principal.js';
import { UsageStatsService } from '../../src/ai/models/UsageStatsService.js';
import { SkillDB } from '../../src/skills/persistence/SkillDB.js';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = {
  tenantId: 'other',
  userId: 'bob',
  roles: ['user'],
};

const logParams = {
  model: 'probe-model',
  inputTokens: 10,
  outputTokens: 5,
  costUSD: 0.01,
  latencyMs: 7,
};

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-usage-scope-'));
  setUserDataDirOverride(root);
  mkdirSync(resolveDataDir(), { recursive: true });
});

afterEach(() => {
  setUserDataDirOverride(null);
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // 句柄未释放 ⇒ 交给系统回收临时目录
  }
});

describe('用量统计读取侧归属（P5）', () => {
  it('汇总/趋势/模型/供应商/日志/计数/延迟均按身份过滤，本地看全库', async () => {
    const usage = await UsageStatsService.openAt(resolveDbPath());
    try {
      // ① 本地（无归属）+ 两个租户各一条
      await usage.logUsage(logParams);
      await runWithPrincipal(ALICE, () => usage.logUsage(logParams));
      await runWithPrincipal(BOB, () => usage.logUsage(logParams));

      // ② 汇总
      expect((await usage.getUsageSummary()).totalRequests).toBe(3);
      const aliceSummary = await runWithPrincipal(ALICE, () =>
        usage.getUsageSummary()
      );
      expect(aliceSummary.totalRequests).toBe(1);
      expect(aliceSummary.totalInputTokens).toBe(10);

      // ③ 每日趋势 / 按模型 / 按供应商
      const aliceTrends = await runWithPrincipal(ALICE, () =>
        usage.getDailyTrends()
      );
      expect(aliceTrends).toHaveLength(1);
      expect(aliceTrends[0].requestCount).toBe(1);

      const aliceModels = await runWithPrincipal(ALICE, () =>
        usage.getModelStats()
      );
      expect(aliceModels).toHaveLength(1);
      expect(aliceModels[0].requestCount).toBe(1);

      const bobProviders = await runWithPrincipal(BOB, () =>
        usage.getProviderStats()
      );
      expect(bobProviders).toHaveLength(1);
      expect(bobProviders[0].requestCount).toBe(1);

      // ④ 请求日志分页 + 总数 + 延迟样本
      const aliceLogs = await runWithPrincipal(ALICE, () =>
        usage.getRequestLogs({})
      );
      expect(aliceLogs.total).toBe(1);
      expect(
        await runWithPrincipal(ALICE, () => usage.getTotalLogCount())
      ).toBe(1);
      expect(await usage.getTotalLogCount()).toBe(3);
      expect(
        (await runWithPrincipal(ALICE, () => usage.getLatencyStats()))
          .sampleCount
      ).toBe(1);
      expect((await usage.getLatencyStats()).sampleCount).toBe(3);
    } finally {
      await usage.close();
    }
  });

  it('技能使用记录查询同样按身份过滤，本地看全库', async () => {
    const db = new SkillDB(resolveDbPath());
    try {
      const record = {
        skillName: 'probe-skill',
        timestamp: Date.now(),
        durationMs: 1,
        success: true,
        source: 'test',
        triggeredBy: 'user' as const,
      };
      await db.insertUsage(record); // 本地
      await runWithPrincipal(ALICE, () => db.insertUsage(record));
      await runWithPrincipal(BOB, () => db.insertUsage(record));

      expect(
        (await runWithPrincipal(ALICE, () => db.queryUsage('probe-skill')))
          .length
      ).toBe(1);
      expect((await db.queryUsage('probe-skill')).length).toBe(3);
      expect(
        (
          await runWithPrincipal(ALICE, () =>
            db.queryUsageByTime(Date.now() - 60_000)
          )
        ).length
      ).toBe(1);
      expect((await db.queryUsageByTime(Date.now() - 60_000)).length).toBe(3);
    } finally {
      await db.close();
    }
  });
});
