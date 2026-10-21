/**
 * 多租户 P3：审批过期清理覆盖分区库
 *
 * 锁两件事：
 *  ① 无请求作用域的定时器（`expireAllScopes`）能把**租户库**里的 pending 置为 expired；
 *  ② 本地库不受影响（各库各清各的，不串库）。
 *
 * 背景：原调度器走 `expireOlderThan()` → `getDb()` ⇒ 定时器无 ALS 作用域 ⇒ 恒本地身份
 * ⇒ 租户库的 pending 永远不会过期（既占着审批位，也让前端一直显示"待处理"）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { Principal } from '../../src/core/identity/principal';
import { runWithPrincipal } from '../../src/core/identity/requestScope';
import { InboxManager } from '../../src/runtime/InboxManager';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };

let dataDir: string;
let manager: InboxManager;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'inbox-expire-'));
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
    // pdca 来源且无 channelSessionId ⇒ 不触发 orphan 告警分支
    source: 'pdca',
  };
}

describe('审批过期清理（P3）', () => {
  it('无作用域定时清理 ⇒ 租户库 pending 变 expired，本地库不受影响', async () => {
    // 租户库：提交一条 pending（连接落在 tenants/acme/users/alice/app.db）
    await runWithPrincipal(ALICE, () => manager.submit(pendingItem('s-alice')));
    expect(
      existsSync(join(dataDir, 'tenants', 'acme', 'users', 'alice', 'app.db'))
    ).toBe(true);

    // 负 TTL ⇒ cutoff 在未来，所有 pending 都应过期（避免依赖毫秒级时序）
    const expired = await manager.expireAllScopes(-1000);
    expect(expired).toBe(1);

    const aliceExpired = await runWithPrincipal(ALICE, () =>
      manager.list({ status: 'expired' })
    );
    expect(aliceExpired.items.length).toBe(1);
    expect(aliceExpired.items[0].sessionId).toBe('s-alice');

    // 本地库：本进程内从未以本地身份打开过 ⇒ 不应被凭空创建
    expect(existsSync(join(dataDir, 'app.db'))).toBe(false);
  });

  it('本地与租户各自清理，互不串库', async () => {
    await manager.submit(pendingItem('s-local'));
    await runWithPrincipal(ALICE, () => manager.submit(pendingItem('s-alice')));

    expect(await manager.expireAllScopes(-1000)).toBe(2);

    expect((await manager.list({ status: 'expired' })).items.length).toBe(1);
    const aliceExpired = await runWithPrincipal(ALICE, () =>
      manager.list({ status: 'expired' })
    );
    expect(aliceExpired.items.length).toBe(1);
  });
});
