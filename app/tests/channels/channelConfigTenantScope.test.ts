/**
 * 多租户 P3：通道配置与凭据按租户映射
 *
 * 锁五件事：
 *  ① 本地（部署级）配置沿用原行（`owner_key IS NULL` / 主键 = type）—— 桌面与 .env 部署零变更；
 *  ② 已认证身份保存配置 ⇒ 落自己的行（主键 `<ownerKey>::<type>`），首次保存自动建行；
 *  ③ 读取按身份隔离：本地读本地、租户读自己、他人读不到（也不会回退到 env）；
 *  ④ `getAllConfigs()` 只列当前身份的配置（本地 ⇒ 部署级配置）；
 *  ⑤ 重启（同一 DB 重新加载）后归属仍正确 —— 归属是持久化事实，不是内存态。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { Principal } from '@modules/core/identity/principal';
import { runWithPrincipal } from '@modules/core/identity/requestScope';
import { ChannelRegistry } from '../../src/channels/registry/ChannelRegistry';
import {
  ChannelSecretStore,
  initRegistry,
} from '../../src/channels/secrets/ChannelSecretStore';
import { Database } from '@modules/core/external/sqlite3';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

let dir: string;
let dbPath: string;
let registry: ChannelRegistry;

/** 等 `updateConfig` 的异步持久化落库（fire-and-forget） */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

function queryRows(
  path: string,
  sql: string
): Promise<Array<Record<string, unknown>>> {
  const db = new Database(path);
  return new Promise((resolve, reject) => {
    db.all(sql, [], (err: Error | null, rows: Record<string, unknown>[]) => {
      try {
        db.close();
      } catch {
        // 关闭失败不影响断言
      }
      if (err) reject(err);
      else resolve(rows ?? []);
    });
  });
}

/** 预置一条**本地**配置（模拟 `register()` 落库后的存量行） */
async function seedLocalConfig(type: string): Promise<void> {
  const db = new Database(dbPath);
  await new Promise<void>((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS channel_configs (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0, options TEXT NOT NULL DEFAULT '{}',
        owner_key TEXT, updated_at INTEGER NOT NULL DEFAULT 0
      )`,
      (err: Error | null) => (err ? reject(err) : resolve())
    );
  });
  await new Promise<void>((resolve, reject) => {
    db.run(
      `INSERT INTO channel_configs (id, name, type, enabled, options, owner_key, updated_at)
       VALUES (?, ?, ?, 1, '{}', NULL, 0)`,
      [type, type, type],
      (err: Error | null) => (err ? reject(err) : resolve())
    );
  });
  try {
    db.close();
  } catch {
    // ignore
  }
}

async function makeRegistry(): Promise<ChannelRegistry> {
  const instance = new ChannelRegistry(dbPath);
  await instance.initPersistence();
  initRegistry(instance);
  return instance;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'channel-tenant-'));
  process.env.LIRI_DATA_DIR = dir;
  dbPath = join(dir, 'app.db');
  await seedLocalConfig('telegram');
  registry = await makeRegistry();
});

afterEach(() => {
  const store = ChannelSecretStore.getInstance();
  try {
    runWithPrincipal(ALICE, () => store.delete('telegram'));
    store.delete('telegram');
  } catch {
    // 清理失败不影响断言
  }
  delete process.env.LIRI_DATA_DIR;
  delete process.env.DISCORD_TOKEN;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows：句柄占用时交给系统清理
  }
});

describe('通道配置/凭据按租户映射（P3）', () => {
  it('本地写自己的行；租户首次保存自动建行且互不可见', async () => {
    const store = ChannelSecretStore.getInstance();

    store.set('telegram', { botToken: 'local-token' });
    runWithPrincipal(ALICE, () =>
      store.set('telegram', { botToken: 'alice-token' })
    );
    await flush();

    // 本地身份仍读本地配置（零变更；`ChannelSecretStore` 负责解密）
    expect(store.get('telegram').botToken).toBe('local-token');
    expect(runWithPrincipal(ALICE, () => store.get('telegram').botToken)).toBe(
      'alice-token'
    );
    // BOB：既读不到 ALICE 的，也读不到本地的（fail-closed）
    expect(runWithPrincipal(BOB, () => store.get('telegram'))).toEqual({});
  });

  it('DB 归属列正确：本地行为 NULL 主键=type，租户行为 <ownerKey>::<type>', async () => {
    const store = ChannelSecretStore.getInstance();
    store.set('telegram', { botToken: 'local-token' });
    runWithPrincipal(ALICE, () =>
      store.set('telegram', { botToken: 'alice-token' })
    );
    await flush();

    const rows = await queryRows(
      dbPath,
      'SELECT id, type, owner_key FROM channel_configs ORDER BY id'
    );
    const byId = new Map(rows.map((r) => [String(r.id), r]));

    expect(byId.get('telegram')?.owner_key ?? null).toBeNull();
    expect(byId.get('acme:alice::telegram')?.owner_key).toBe('acme:alice');
    expect(byId.size).toBe(2);
  });

  it('getAllConfigs 只列当前身份的配置', async () => {
    const store = ChannelSecretStore.getInstance();
    store.set('telegram', { botToken: 'local-token' });
    runWithPrincipal(ALICE, () =>
      store.set('telegram', { botToken: 'alice-token' })
    );
    await flush();

    expect(registry.getAllConfigs().map((c) => c.type)).toEqual(['telegram']);
    expect(
      runWithPrincipal(ALICE, () =>
        registry.getAllConfigs().map((c) => c.ownerKey)
      )
    ).toEqual(['acme:alice']);
    expect(runWithPrincipal(BOB, () => registry.getAllConfigs())).toEqual([]);
  });

  it('租户身份不回退到宿主机 env 凭据（本地身份仍可回退）', () => {
    process.env.DISCORD_TOKEN = 'host-token';
    const store = ChannelSecretStore.getInstance();

    // 本地：DB 无 discord 凭据 ⇒ 允许 env 回退（既有行为）
    expect(store.get('discord').botToken).toBe('host-token');
    // 租户：绝不继承宿主机 token
    expect(runWithPrincipal(ALICE, () => store.get('discord'))).toEqual({});
  });

  it('重启后归属仍是持久化事实（同一 DB 重新加载）', async () => {
    const store = ChannelSecretStore.getInstance();
    store.set('telegram', { botToken: 'local-token' });
    runWithPrincipal(ALICE, () =>
      store.set('telegram', { botToken: 'alice-token' })
    );
    await flush();

    await makeRegistry();
    const reloadedStore = ChannelSecretStore.getInstance();

    expect(reloadedStore.get('telegram').botToken).toBe('local-token');
    expect(
      runWithPrincipal(ALICE, () => reloadedStore.get('telegram').botToken)
    ).toBe('alice-token');
    expect(runWithPrincipal(BOB, () => reloadedStore.get('telegram'))).toEqual(
      {}
    );
  });
});
