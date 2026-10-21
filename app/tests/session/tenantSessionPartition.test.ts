/**
 * 会话物理分区 + 归属（多租户 P1）
 *
 * 证四件事（这是 P1 的验收口径）：
 *  ① 已认证身份创建的会话**落在自己的分区**：`<data>/tenants/<t>/users/<u>/sessions/<hash>/<id>/`；
 *  ② 会话元数据写入归属（`owner`）；
 *  ③ 同一实例下，**另一个身份按 id 读取 ⇒ null**（越权读不到，HTTP 层据此 404）；
 *  ④ 本地身份也读不到分区会话（分区与共享根物理分离，不是仅靠过滤）。
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { Principal } from '../../src/core/identity/principal';
import { runWithPrincipal } from '../../src/core/identity/requestScope';
import { resolveWorktreeHash } from '../../src/core/paths';
import { SessionGateway } from '../../src/session/SessionGateway';

const ALICE: Principal = {
  tenantId: 'acme',
  userId: 'alice',
  roles: ['user'],
};
const BOB: Principal = {
  tenantId: 'acme',
  userId: 'bob',
  roles: ['user'],
};

let dataDir: string;
let gw: SessionGateway;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'tenant-partition-'));
  process.env.LIRI_DATA_DIR = dataDir;
  gw = new SessionGateway();
});

afterEach(async () => {
  await gw.close();
  delete process.env.LIRI_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('会话分区：物理隔离', () => {
  it('已认证身份创建的会话落在 tenants/<t>/users/<u>/sessions 下，并写入归属', async () => {
    const created = await runWithPrincipal(ALICE, () =>
      gw.createSession({ title: 'alice-session' })
    );

    expect(created.metadata?.owner).toEqual({
      tenantId: 'acme',
      userId: 'alice',
    });

    const expected = join(
      dataDir,
      'tenants',
      'acme',
      'users',
      'alice',
      'sessions',
      resolveWorktreeHash(),
      created.id,
      'session.json'
    );
    expect(existsSync(expected)).toBe(true);

    // 共享根下**不应**出现该会话（确认是物理分区，不是逻辑过滤）
    const shared = join(
      dataDir,
      'sessions',
      resolveWorktreeHash(),
      created.id,
      'session.json'
    );
    expect(existsSync(shared)).toBe(false);
  });

  it('本人可读，其他身份与本地身份都读不到（越权 ⇒ null ⇒ HTTP 404）', async () => {
    const created = await runWithPrincipal(ALICE, () =>
      gw.createSession({ title: 'alice-private' })
    );

    const own = await runWithPrincipal(ALICE, () => gw.getSession(created.id));
    expect(own).not.toBeNull();

    const other = await runWithPrincipal(BOB, () => gw.getSession(created.id));
    expect(other).toBeNull();

    const local = await gw.getSession(created.id);
    expect(local).toBeNull();
  });

  it('列表按身份分区：BOB 看不到 ALICE 的会话', async () => {
    await runWithPrincipal(ALICE, () =>
      gw.createSession({ title: 'alice-only' })
    );

    const aliceList = await runWithPrincipal(ALICE, () => gw.listSessions());
    expect(aliceList.length).toBe(1);

    const bobList = await runWithPrincipal(BOB, () => gw.listSessions());
    expect(bobList.length).toBe(0);
  });
});
