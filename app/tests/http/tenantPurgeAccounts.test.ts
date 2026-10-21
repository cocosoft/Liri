/**
 * 多租户 P3：删除租户 ⇒ **解绑该租户的账号**（不留悬空绑定）
 *
 * 背景：`DELETE /v1/tenants/:tenantId` 只清数据分区；账号仍钉在已删租户上 ⇒ 这些
 * 用户下次登录会拿到"指向已删租户"的身份，并**重建空分区**（数据面看着像回来了）。
 *
 * 现口径（删除成功后，`purgeTenant` 已跑完）：
 * - 该租户下所有账号**解绑回本地租户**（只改归属，不删账号、不改密码）；
 * - 撤销这些账号的**活动 token**（token 带的是登录时刻的租户）；
 * - 结果如实写进响应 `unboundUsers` / `revokedTokens` 与同一条 `tenant.purge` 审计；
 * - **清除失败（500）时不解绑**（数据还在，解绑会让它彻底失联）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type http from 'http';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { setUserDataDirOverride } from '../../src/core/paths.js';
import { AuthUserStore } from '../../src/infrastructure/http/auth/AuthUserStore.js';
import type { TenantPurgeReport } from '../../src/runtime/tenantPurge.js';
import { handleDeleteTenant } from '../../src/infrastructure/http/handlers/tenant-handlers.js';
import {
  __setAuthUserStoreForTest,
  authTokens,
} from '../../src/infrastructure/http/handlers/auth-handlers.js';

let root: string;
let store: AuthUserStore;
let storeFile: string;
const tokensToClean: string[] = [];

function makeReq(method = 'DELETE'): http.IncomingMessage {
  return { method, on: () => {} } as unknown as http.IncomingMessage;
}

function createRes(): {
  res: http.ServerResponse;
  read: () => { status: number; body: Record<string, unknown> };
} {
  const out = { status: 0, body: '' };
  const res = {
    writeHead: (code: number) => {
      out.status = code;
    },
    end: (chunk?: string) => {
      out.body = chunk ?? '';
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    read: () => ({
      status: out.status,
      body: out.body ? (JSON.parse(out.body) as Record<string, unknown>) : {},
    }),
  };
}

function makeReport(
  tenantId: string,
  blocked: TenantPurgeReport['blocked'] = []
): TenantPurgeReport {
  return {
    tenantId,
    ownerPrefix: `${tenantId}:`,
    removed: {
      tenantDataDir: true,
      channelConfigs: 0,
      cronJobs: 0,
      taskFlows: 0,
      usageRecords: 0,
      modelUsageLogs: 0,
      skillUsageRecords: 0,
      projects: 0,
      sseConnections: 0,
      tenantChannels: 0,
      scopedConnections: 0,
      dailyBudgets: 0,
      scopedCaches: 0,
      approvedCommands: 0,
    },
    blocked,
    notPurged: [],
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-purge-accounts-'));
  setUserDataDirOverride(root);
  storeFile = join(root, 'users.json');
  store = new AuthUserStore(storeFile);
  __setAuthUserStoreForTest(store);

  store.addUser('alice', 'pw', 'user', 'acme');
  store.addUser('bob', 'pw', 'user', 'other');
  store.addUser('carol', 'pw');
  for (const username of ['alice', 'bob', 'carol']) {
    const token = `tok-purge-${username}`;
    authTokens.set(token, { username, permissions: ['read', 'write'] });
    tokensToClean.push(token);
  }
});

afterEach(() => {
  for (const token of tokensToClean.splice(0)) authTokens.delete(token);
  setUserDataDirOverride(null);
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // @ignore-catch — Windows 句柄可能延迟释放，清理失败不影响断言
  }
});

describe('删除租户 ⇒ 解绑该租户账号', () => {
  it('只解绑本租户账号：其余租户与本地账号不受影响，token 同步撤销', async () => {
    const { res, read } = createRes();
    await handleDeleteTenant(makeReq(), res, 'acme', async () =>
      makeReport('acme')
    );

    const { status, body } = read();
    expect(status).toBe(200);
    expect(body.unboundUsers).toEqual(['alice']);
    expect(body.revokedTokens).toBe(1);
    expect(body.unboundError).toBeUndefined();

    // 归属：acme 账号回本地；other / 无归属账号不变
    expect(store.getUser('alice')?.tenantId).toBeUndefined();
    expect(store.getUser('bob')?.tenantId).toBe('other');
    expect(store.getUser('carol')?.tenantId).toBeUndefined();

    // token：只撤销 alice 的
    expect(authTokens.has('tok-purge-alice')).toBe(false);
    expect(authTokens.has('tok-purge-bob')).toBe(true);
    expect(authTokens.has('tok-purge-carol')).toBe(true);

    // 落盘：新开 store 读回同一文件，绑定确实被清掉（不是只在内存里）
    const reloaded = new AuthUserStore(storeFile);
    expect(reloaded.getUser('alice')?.tenantId).toBeUndefined();
    expect(reloaded.getUser('bob')?.tenantId).toBe('other');
  });

  it('该租户没有账号 ⇒ unboundUsers 为空、撤销 0（不误伤）', async () => {
    const { res, read } = createRes();
    await handleDeleteTenant(makeReq(), res, 'nobody', async () =>
      makeReport('nobody')
    );

    const { status, body } = read();
    expect(status).toBe(200);
    expect(body.unboundUsers).toEqual([]);
    expect(body.revokedTokens).toBe(0);
    expect(authTokens.has('tok-purge-alice')).toBe(true);
  });

  it('清除失败（500）⇒ 不解绑（数据还在，解绑会让它彻底失联）', async () => {
    const { res, read } = createRes();
    await handleDeleteTenant(makeReq(), res, 'acme', async () => {
      throw new Error('purge exploded');
    });

    expect(read().status).toBe(500);
    expect(store.getUser('alice')?.tenantId).toBe('acme');
    expect(authTokens.has('tok-purge-alice')).toBe(true);
  });

  it('tenantId 非法（local）⇒ 400 且不调用清除器、不解绑', async () => {
    let purged = 0;
    const { res, read } = createRes();
    await handleDeleteTenant(makeReq(), res, 'local', async () => {
      purged += 1;
      return makeReport('local');
    });

    expect(read().status).toBe(400);
    expect(purged).toBe(0);
    expect(store.getUser('alice')?.tenantId).toBe('acme');
  });
});
