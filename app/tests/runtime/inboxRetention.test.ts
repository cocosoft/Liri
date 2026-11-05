/**
 * A3（2026-11-05）：`inbox_items` 终态行归档回收
 *
 * 背景：`expireAllScopes` 只把 pending 置为 `expired`，**从不删行** ——
 * 实测 991 条里 934 条终态永久占库。本文件锁定：
 *  ① 终态 + 超龄 ⇒ 删除；② pending 超龄 ⇒ 永不删除；
 *  ③ 未超龄终态 ⇒ 保留；④ 租户分区库同样回收。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { Database } from '@openliri/infra/external';

import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope';
import { InboxManager } from '@modules/runtime/InboxManager';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const DAY = 24 * 60 * 60 * 1000;

let dataDir: string;
let manager: InboxManager;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'inbox-retention-'));
  process.env.LIRI_DATA_DIR = dataDir;
  manager = new InboxManager();
});

afterEach(() => {
  manager.dispose();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows：未关闭的 SQLite 连接可能持有目录锁（EBUSY）⇒ 交给系统清理
  }
});

function pendingItem(sessionId: string) {
  return {
    sessionId,
    type: 'approval' as const,
    title: '需要确认',
    message: '运行命令?',
    offlineCapable: true,
    source: 'pdca',
  };
}

/** 直接改 created_at 把条目"做旧"（`submit()` 不接受自定义时间戳） */
async function backdate(
  dbFile: string,
  sessionIds: string[],
  ageMs: number
): Promise<void> {
  const db = new Database(dbFile);
  try {
    for (const sid of sessionIds) {
      await new Promise<void>((resolve, reject) => {
        db.run(
          'UPDATE inbox_items SET created_at = ? WHERE session_id = ?',
          [Date.now() - ageMs, sid],
          (err: Error | null) => (err ? reject(err) : resolve())
        );
      });
    }
  } finally {
    await new Promise<void>((resolve) => db.close(() => resolve()));
  }
}

describe('inbox 终态行归档回收（A3）', () => {
  it('终态 + 超龄 ⇒ 删除；pending 超龄 ⇒ 保留', async () => {
    await manager.submit(pendingItem('s-expired'));
    // 与线上同序：先过期（pending → expired），再按龄回收
    await manager.expireAllScopes(-1000);
    await manager.submit(pendingItem('s-pending'));
    await backdate(
      join(dataDir, 'app.db'),
      ['s-expired', 's-pending'],
      40 * DAY
    );

    expect(await manager.purgeOlderThanAllScopes(Date.now() - 30 * DAY)).toBe(
      1
    );
    expect(
      (await manager.list({ status: 'pending' })).items.map((i) => i.sessionId)
    ).toEqual(['s-pending']);
    expect((await manager.list({ status: 'expired' })).items.length).toBe(0);
  });

  it('未超龄终态 ⇒ 保留（不误删刚处理完的卡）', async () => {
    await manager.submit(pendingItem('s-fresh'));
    await manager.expireAllScopes(-1000);

    expect(await manager.purgeOlderThanAllScopes(Date.now() - 30 * DAY)).toBe(
      0
    );
    expect((await manager.list({ status: 'expired' })).items.length).toBe(1);
  });

  it('租户分区库同样回收（不串库）', async () => {
    await runWithPrincipal(ALICE, () => manager.submit(pendingItem('s-alice')));
    await manager.expireAllScopes(-1000);
    await backdate(
      join(dataDir, 'tenants', 'acme', 'app.db'),
      ['s-alice'],
      40 * DAY
    );

    expect(await manager.purgeOlderThanAllScopes(Date.now() - 30 * DAY)).toBe(
      1
    );
    const aliceExpired = await runWithPrincipal(ALICE, () =>
      manager.list({ status: 'expired' })
    );
    expect(aliceExpired.items.length).toBe(0);
  });
});
