/**
 * P2-9（2026-09-25）：迁移**版本中枢**（`app_migrations`）单测。
 *
 * 覆盖 spec §6：建表幂等 / 字段往返 / **跨实例持久化** / **单向状态机**（`applied` 终态不可改写）
 * / `failed → applied`（重试）与 `failed → reverted`（恢复）允许。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import {
  AppMigrationStore,
  APP_MIGRATIONS_TABLE,
} from '../../../src/core/migration/AppMigrationStore';
import { Database } from '@modules/core/external/sqlite3';

const createdPaths: string[] = [];
const opened: AppMigrationStore[] = [];

async function makeStore(): Promise<{
  store: AppMigrationStore;
  path: string;
}> {
  const path = join(tmpdir(), `app-migrations-${randomUUID().slice(0, 8)}.db`);
  createdPaths.push(path);
  const store = new AppMigrationStore(path);
  opened.push(store);
  await store.init();
  return { store, path };
}

afterEach(() => {
  while (opened.length > 0) opened.pop()!.close();
  while (createdPaths.length > 0) {
    try {
      unlinkSync(createdPaths.pop()!);
    } catch {
      // @ignore-catch — 清理临时文件失败不影响断言
    }
  }
});

describe('AppMigrationStore（P2-9 版本中枢）', () => {
  test('建表幂等：重复 init 不抛，且表存在', async () => {
    const { store, path } = await makeStore();
    await store.init(); // 二次 init 幂等
    expect(await store.listAll()).toEqual([]);

    // 直接核对建表结果（列齐全）
    const db = new Database(path);
    const cols = await new Promise<string[]>((resolve, reject) => {
      db.all(
        `PRAGMA table_info(${APP_MIGRATIONS_TABLE})`,
        (err: Error | null, rows: Array<{ name: string }> | undefined) =>
          err ? reject(err) : resolve((rows ?? []).map((r) => r.name))
      );
    });
    db.close();
    expect(cols).toEqual([
      'id',
      'module',
      'from_version',
      'to_version',
      'status',
      'applied_at',
      'last_error',
      'snapshot_path',
      'updated_at',
    ]);
  });

  test('写入后字段完整往返；跨实例持久化（新 store 读同一 DB 仍在）', async () => {
    const { store, path } = await makeStore();
    await store.upsert({
      id: 'demo.1->2',
      module: 'demo',
      fromVersion: '1',
      toVersion: '2',
      status: 'applied',
      appliedAt: 1700000000000,
    });

    const row = await store.get('demo.1->2');
    expect(row).toMatchObject({
      id: 'demo.1->2',
      module: 'demo',
      fromVersion: '1',
      toVersion: '2',
      status: 'applied',
      appliedAt: 1700000000000,
    });

    const reopened = new AppMigrationStore(path);
    opened.push(reopened);
    await reopened.init();
    expect((await reopened.get('demo.1->2'))?.status).toBe('applied');
  });

  test('单向状态机：applied 为终态 ⇒ 拒绝改写（upsert 返回 false 且行不变）', async () => {
    const { store } = await makeStore();
    expect(
      await store.upsert({
        id: 'demo.1->2',
        module: 'demo',
        toVersion: '2',
        status: 'applied',
      })
    ).toBe(true);

    // 修复前（无守卫）会静默改写 ⇒ 本条必失败
    expect(
      await store.upsert({
        id: 'demo.1->2',
        module: 'demo',
        toVersion: '2',
        status: 'failed',
        lastError: '不该生效',
      })
    ).toBe(false);
    const row = await store.get('demo.1->2');
    expect(row?.status).toBe('applied');
    expect(row?.lastError).toBeUndefined();
  });

  test('failed → applied（重试成功）允许', async () => {
    const { store } = await makeStore();
    await store.upsert({
      id: 'demo.1->2',
      module: 'demo',
      toVersion: '2',
      status: 'failed',
      lastError: 'boom',
    });
    expect(
      await store.upsert({
        id: 'demo.1->2',
        module: 'demo',
        toVersion: '2',
        status: 'applied',
        appliedAt: 1,
        lastError: 'boom',
      })
    ).toBe(true);
    expect((await store.get('demo.1->2'))?.status).toBe('applied');
  });

  test('failed → reverted（恢复快照）允许', async () => {
    const { store } = await makeStore();
    await store.upsert({
      id: 'demo.1->2',
      module: 'demo',
      toVersion: '2',
      status: 'failed',
      lastError: 'boom',
    });
    expect(
      await store.upsert({
        id: 'demo.1->2',
        module: 'demo',
        toVersion: '2',
        status: 'reverted',
      })
    ).toBe(true);
    expect((await store.get('demo.1->2'))?.status).toBe('reverted');
  });
});
