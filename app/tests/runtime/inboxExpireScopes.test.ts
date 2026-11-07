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

import { Database } from '@openliri/infra/external';

import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope';
import {
  InboxManager,
  onInboxItemsExpired,
} from '@openliri/service/runtime/InboxManager';

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
  // 2026-11-07（隐藏缺陷 #1）：过期必须能被入口层观测到 —— PDCA 步骤卡的卡一旦过期
  // 就不可回复，若不收口任务，任务会永久停在 stage_awaiting_approval 并锁死会话幂等键。
  it('过期回调携带卡片（含 pdcaTaskId），入口层据此收口任务', async () => {
    const seen: Array<{ id: string; pdcaTaskId?: string }> = [];
    const off = onInboxItemsExpired((item) => {
      seen.push({
        id: item.id,
        pdcaTaskId:
          typeof item.metadata?.pdcaTaskId === 'string'
            ? item.metadata.pdcaTaskId
            : undefined,
      });
    });
    try {
      const submitted = await manager.submit({
        ...pendingItem('s-expire-cb'),
        metadata: { pdcaTaskId: 'pdca_cb_1' },
      });
      await manager.expireAllScopes(-1000);
      expect(seen).toContainEqual({
        id: submitted.id,
        pdcaTaskId: 'pdca_cb_1',
      });
    } finally {
      off();
    }
  });

  it('expireByIds 只置过期指定 pending 行（同步骤旧卡清理用）', async () => {
    const keep = await manager.submit(pendingItem('s-keep'));
    const target = await manager.submit(pendingItem('s-target'));

    const changed = await manager.expireByIds([target.id]);
    expect(changed).toBe(1);

    const pending = await manager.list({ status: 'pending' });
    expect(pending.items.map((i) => i.id)).toEqual([keep.id]);
    const expired = await manager.list({ status: 'expired' });
    expect(expired.items.map((i) => i.id)).toEqual([target.id]);
  });

  it('无作用域定时清理 ⇒ 租户库 pending 变 expired，本地库不受影响', async () => {
    // 租户库（§6.1）：提交一条 pending（连接落在 tenants/acme/app.db）
    await runWithPrincipal(ALICE, () => manager.submit(pendingItem('s-alice')));
    expect(existsSync(join(dataDir, 'tenants', 'acme', 'app.db'))).toBe(true);
    expect(
      existsSync(join(dataDir, 'tenants', 'acme', 'users', 'alice', 'app.db'))
    ).toBe(false);

    // 负 TTL ⇒ cutoff 在未来，所有 pending 都应过期（避免依赖毫秒级时序）
    const expired = await manager.expireAllScopes(-1000);
    expect(expired).toBe(1);

    const aliceExpired = await runWithPrincipal(ALICE, () =>
      manager.list({ status: 'expired' })
    );
    expect(aliceExpired.items.length).toBe(1);
    expect(aliceExpired.items[0].sessionId).toBe('s-alice');

    // 本地库：**不得被写入任何审批**。
    //
    // 为什么判"无数据"而不是"文件不存在"（2026-11-03 全量失败根因）：
    // 宿主装配（`ChatManager` 构造时的 `installHostWiring`）会**进程级**注入
    // `setSessionOwnerLoader`；其读路径 `listTicketAssignmentsBySession` 会打开
    // `<dataDir>/app.db`（该文件可能只有派工表）。那是"有连接"，不是"本地库受影响"。
    // 故断言收敛到真正的口径：以**本地身份**读本地库，其中没有任何 inbox 行。
    const localItems = await manager.list({});
    expect(localItems.items.length).toBe(0);
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

/**
 * 审批过期 TTL 分层（2026-11-04，运行态排查 P0-1）
 *
 * 缺陷现场：全局 5 分钟 TTL ⇒ `inbox_items` 991 条里 934 条 expired、仅 46 条 replied；
 * 181 张「工作区访问申请」全部过期，过期后同一目标又被重新建卡（同一目标 2–3 张）。
 *
 * 口径：工具审批 30 分钟；`metadata.kind === 'workspace-scope'` 24 小时。
 */
describe('审批过期 TTL 分层（P0-1）', () => {
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;

  /** 直接改 created_at 把卡片"做旧"（submit 不接受自定义时间戳） */
  async function backdate(sessionIds: string[], ageMs: number): Promise<void> {
    const db = new Database(join(dataDir, 'app.db'));
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

  const workspaceScopeItem = (sessionId: string) => ({
    ...pendingItem(sessionId),
    title: '工作区访问申请: E:\\PY',
    metadata: { kind: 'workspace-scope', workspaceScopeRoot: 'E:\\PY' },
  });

  it('40 分钟前：工具审批过期，工作区申请仍 pending', async () => {
    await manager.submit(pendingItem('s-tool'));
    await manager.submit(workspaceScopeItem('s-ws'));
    await backdate(['s-tool', 's-ws'], 40 * MIN);

    expect(await manager.expireAllScopes(30 * MIN, 24 * HOUR)).toBe(1);

    const expired = await manager.list({ status: 'expired' });
    expect(expired.items.map((i) => i.sessionId)).toEqual(['s-tool']);
    const pending = await manager.list({ status: 'pending' });
    expect(pending.items.map((i) => i.sessionId)).toEqual(['s-ws']);
  });

  it('显式传入更短的工作区 TTL ⇒ 工作区申请也会过期（参数不被写死）', async () => {
    await manager.submit(workspaceScopeItem('s-ws2'));
    await backdate(['s-ws2'], 40 * MIN);

    expect(await manager.expireAllScopes(30 * MIN, 10 * MIN)).toBe(1);
    expect((await manager.list({ status: 'pending' })).items.length).toBe(0);
  });

  it('缺省第二参数 ⇒ 与工具审批同口径（向后兼容旧调用）', async () => {
    await manager.submit(workspaceScopeItem('s-ws3'));
    await backdate(['s-ws3'], 40 * MIN);

    expect(await manager.expireAllScopes(30 * MIN)).toBe(1);
  });
});
