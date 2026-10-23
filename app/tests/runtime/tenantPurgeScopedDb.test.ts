/**
 * 多租户 P5：`purgeTenant` 在删分区目录**之前**关闭按身份缓存的连接
 *
 * 这是台账第十七批 `blocked=1` 的正面修复证据：用**真实 sqlite 句柄**占住
 * `data/tenants/<t>/users/alice/app.db`，登记 closer 后跑 `purgeTenant` ——
 * 目录必须真的被删掉、`blocked` 不含本租户条目；closer 失败时则如实记进 `blocked`。
 *
 * 说明：登记表是**进程级**全局，其他用例文件可能留下未关闭的登记 ⇒ 本文件用
 * **独有租户标识**（`purge-ten` / `purge-ten-fail`），只对本租户做绝对断言。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { Database } from '@openliri/kernel/external/sqlite3.js';
import {
  resolveDataDir,
  setUserDataDirOverride,
} from '@openliri/kernel/paths.js';
import { purgeTenant } from '../../src/runtime/tenantPurge.js';
import {
  registerScopedResource,
  resetScopedResourcesForTest,
  scopedResourceCount,
} from '@openliri/kernel/identity/scopedResources.js';

let root: string;

/** 在分区目录里开一个真连接（模拟"该租户刚被访问过"） */
function openTenantDb(
  tenantId: string,
  userId: string
): { dir: string; db: Database } {
  const dir = join(resolveDataDir(), 'tenants', tenantId, 'users', userId);
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, 'app.db'));
  db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, v TEXT)');
  db.exec("INSERT INTO probe (v) VALUES ('x')");
  return { dir, db };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-purge-scoped-'));
  setUserDataDirOverride(root);
});

afterEach(() => {
  setUserDataDirOverride(null);
  resetScopedResourcesForTest();
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // @ignore-catch — Windows 句柄可能延迟释放，清理失败不影响断言
  }
});

describe('purgeTenant：先关连接再删目录', () => {
  it('登记过的分区连接被关闭 ⇒ 目录真的删掉且 blocked 不含本租户条目', async () => {
    const { dir, db } = openTenantDb('purge-ten', 'alice');
    const registrationsBefore = scopedResourceCount();
    registerScopedResource('purge-ten:alice', () => {
      db.close();
    });

    const report = await purgeTenant('purge-ten');

    expect(report.removed.scopedConnections).toBe(1);
    expect(report.removed.tenantDataDir).toBe(true);
    expect(report.blocked.filter((b) => b.path.includes('purge-ten'))).toEqual(
      []
    );
    expect(existsSync(dir)).toBe(false);
    // 本租户的登记被摘除；其他用例留下的登记不受影响
    expect(scopedResourceCount()).toBe(registrationsBefore);
  });

  it('closer 抛错 ⇒ 如实记进 blocked（可重跑），不谎报成功', async () => {
    openTenantDb('purge-ten-fail', 'alice');
    const before = scopedResourceCount();
    registerScopedResource('purge-ten-fail:alice', () => {
      throw new Error('database is locked');
    });

    const report = await purgeTenant('purge-ten-fail');

    expect(report.removed.scopedConnections).toBe(0);
    expect(
      report.blocked.some(
        (b) =>
          b.path === 'scopedResource:purge-ten-fail:alice' &&
          b.error.includes('database is locked')
      )
    ).toBe(true);
    // 失败的登记**保留**（可重跑），不像成功那样被摘除
    expect(scopedResourceCount()).toBe(before + 1);
  });
});
