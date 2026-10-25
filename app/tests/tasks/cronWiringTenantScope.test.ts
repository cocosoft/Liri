// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * T25-02 补（2026-10-25）：Cron / 日历装配点的**库路径随身份**。
 *
 * 缺陷（盘点 §9.6）：三处装配把库路径钉死为 `resolveDbPath()` ⇒ 已认证租户请求
 * 读写的是**本地共享库**（`cron_jobs` 虽有 `owner_key`，但读的是错库 ⇒ 看不到自己的任务，
 * 也可能读到本地任务）。本文件锁住三处装配不再回退到 `resolveDbPath()`。
 *
 * 口径：本地身份下 `resolveTenantDbPath()` 与 `resolveDbPath()` **等值**
 * （`tenantScopedDataRoot` 对本地原样返回）⇒ 桌面/CLI 零行为变更。
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}

describe('T25-02 补：Cron/日历装配按身份取库', () => {
  it('ScheduleHook 用 resolveTenantDbPath 构造 CronJobStore / AIScheduleIndex', () => {
    const src = read('../../src/modules/calendar/ScheduleHook.ts');
    expect(src).toContain('resolveTenantDbPath');
    expect(src).toContain('new CronJobStore(resolveTenantDbPath())');
    expect(src).toContain('new AIScheduleIndex(resolveTenantDbPath())');
    expect(src).not.toContain('new CronJobStore(resolveDbPath())');
    expect(src).not.toContain('new AIScheduleIndex(resolveDbPath())');
  });

  it('CalendarMerger 同口径', () => {
    const src = read('../../src/modules/calendar/CalendarMerger.ts');
    expect(src).toContain('new CronJobStore(resolveTenantDbPath())');
    expect(src).toContain('new AIScheduleIndex(resolveTenantDbPath())');
    expect(src).not.toContain('new CronJobStore(resolveDbPath())');
    expect(src).not.toContain('new AIScheduleIndex(resolveDbPath())');
  });

  it('domainSnapshotOps 的 Cron 句柄工厂按身份取库', () => {
    const src = read('../../src/runtime/api/domainSnapshotOps.ts');
    expect(src).toContain('resolveTenantDbPath');
    expect(src).toContain('new CronJobStore(resolveTenantDbPath())');
    expect(src).toContain('new CronRunLog(resolveTenantDbPath())');
    expect(src).not.toContain('new CronJobStore(resolveDbPath())');
    expect(src).not.toContain('new CronRunLog(resolveDbPath())');
  });
});
