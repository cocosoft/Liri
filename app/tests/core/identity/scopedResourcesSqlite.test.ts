/**
 * ScopedResources：**真句柄**回归（Windows 关键）
 *
 * 这条用例直接复现台账第十七批冒烟里的 `blocked=1`：分区 `app.db` 连接未关时
 * `rmSync` 失败；登记并关闭后目录可以删掉。
 *
 * 用真实 sqlite 连接（不用 stub）—— 这是本模块唯一能证明"关掉连接 ⇒ 目录可删"的
 * 证据链；纯 closer 计数用例（`scopedResources.test.ts`）覆盖不到这一步。
 */
import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { Database } from '@modules/external';
import {
  closeScopedResourcesForTenant,
  registerScopedResource,
  resetScopedResourcesForTest,
} from '@openliri/kernel/identity/scopedResources.js';

const roots: string[] = [];

function makeTenantDb(
  tenantId: string,
  userId: string
): {
  root: string;
  dir: string;
  dbPath: string;
  db: InstanceType<typeof Database>;
} {
  const root = mkdtempSync(join(tmpdir(), 'liri-scoped-res-'));
  roots.push(root);
  const dir = join(root, 'data', 'tenants', tenantId, 'users', userId);
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, 'app.db');
  const db = new Database(dbPath);
  // 写点东西确保文件真的落盘、句柄真的持有
  db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, v TEXT)');
  db.exec("INSERT INTO probe (v) VALUES ('x')");
  return { root, dir, dbPath, db };
}

/**
 * 登记表是**进程级全局**：全量套跑时其他用例文件（如 `costRepositoryOwnerScope`、
 * `scopedDbClose`，都以 `acme:*` 身份建过真库）留下的注册会污染本文件的**绝对计数** ——
 * Linux 上 `tests/core/identity/**` 可能先于 `tests/cost/**` 跑，实测 `closed` 变成 2。
 * ⇒ 与 `packages/kernel/tests/identity/scopedResources.test.ts` 同一条约定：
 * ① `beforeEach` 重置登记表；② 用**本文件独有**的租户前缀（`sq-*`）。
 */
beforeEach(() => {
  resetScopedResourcesForTest();
});

afterEach(() => {
  resetScopedResourcesForTest();
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      // @ignore-catch — 清理失败不影响断言（Windows 句柄可能延迟释放）
    }
  }
});

describe('ScopedResources：真 sqlite 句柄', () => {
  it('登记后按租户关闭 ⇒ 分区目录可删（复现 blocked 场景）', async () => {
    const { root, dir, dbPath, db } = makeTenantDb('sq-res', 'alice');
    const instances = new Map<string, InstanceType<typeof Database>>([
      ['sq-res:alice', db],
    ]);

    // 关闭前：句柄占用 ⇒ Windows 上目录删不掉（这就是 purge 的 blocked）
    let blockedBeforeClose = false;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      blockedBeforeClose = true;
    }
    if (process.platform === 'win32') {
      expect(blockedBeforeClose).toBe(true);
      expect(existsSync(dbPath)).toBe(true);
    }

    registerScopedResource('sq-res:alice', () => {
      db.close();
      instances.delete('sq-res:alice');
    });

    const result = await closeScopedResourcesForTenant('sq-res');

    expect(result.closed).toBe(1);
    expect(result.failed).toEqual([]);
    // closer 必须同时摘掉自己的缓存（否则下次访问会拿到已关闭实例）
    expect(instances.size).toBe(0);

    // 关闭后：目录可删，文件真的没了
    expect(() => rmSync(dir, { recursive: true, force: true })).not.toThrow();
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(root)).toBe(true); // 只删了该用户分区，数据根仍在
  });

  it('未登记的连接不会被关（只影响匹配的租户）', async () => {
    const scoped = makeTenantDb('sq-res', 'alice');
    const other = makeTenantDb('sq-other', 'bob');

    registerScopedResource('sq-res:alice', () => scoped.db.close());

    const result = await closeScopedResourcesForTenant('sq-res');
    expect(result.closed).toBe(1);

    // 另一个租户的连接仍然可用
    expect(() =>
      other.db.exec("INSERT INTO probe (v) VALUES ('still-alive')")
    ).not.toThrow();
    other.db.close();
  });
});
