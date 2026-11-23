// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 审批过期 ⇒ 会话状态收敛（2026-11-21，P1-2 / C5 验收守卫）
 *
 * 锁四件事：
 *   ① 普通聊天会话的审批卡过期 ⇒ **持久化** `UnifiedSession.status` 从 `requires_action`
 *      收回 `active`（真实链路：inbox 过期 → `convergeSessionAfterApprovalExpiry` →
 *      组合根会话网关；`SessionStateMachine.complete()` 只改内存态，覆盖不到列表读的库字段）；
 *   ② 幂等：同一张卡重复过期 / 会话已是 `active` ⇒ 不再重复落盘；
 *   ③ PDCA 步骤卡 / 工作区访问申请 ⇒ 不在本函数收口（分别由 `abortPdcaAfterExpiry`
 *      与「能力授予」语义处理，避免双重收口）；
 *   ④ 启动对账：只收回「状态仍是 `requires_action`」的会话，`active` 会话不被写。
 *
 * 隔离：组合根端口用替身（不触真实 SessionGateway / 消息存储）。
 */
import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SessionStatus } from '@modules/session/types/UnifiedSession';
import type { InboxItem } from '@openliri/service/runtime/InboxManager';

// 隔离：收敛函数用的是模块级 `inboxManager` 单例 ⇒ 先把数据目录指到临时目录再动态导入，
// 避免测试读写真实 `~/.pyapp/data/app.db`（同 `pdcaExpiryAbort.test.ts` 的口径）。
const dataDir = mkdtempSync(join(tmpdir(), 'approval-expiry-converge-'));
process.env.LIRI_DATA_DIR = dataDir;

const {
  convergeSessionAfterApprovalExpiry,
  reconcileStuckApprovalSessions,
  releaseSessionAfterApproval,
} = await import('@openliri/service/runtime/inboxApproval');
const { normalizeApprovalTtlMs, APPROVAL_TTL_MS } =
  await import('@openliri/service/runtime/InboxManager');
const { registerRuntimeCoreApiProvider } =
  await import('@openliri/service/runtime/api/coreApiProvider');

interface FakeSession {
  id?: string;
  status?: SessionStatus;
  metadata?: object;
}

interface FakeGatewayState {
  sessions: FakeSession[];
  updates: Array<{ id?: string; status?: SessionStatus }>;
}

/** 装一个会话网关替身：getSession 返回副本，updateSession 写回数组（模拟持久化） */
function stubGateway(sessions: FakeSession[]): FakeGatewayState {
  const state: FakeGatewayState = { sessions, updates: [] };
  const gateway = {
    getSession: async (id: string) => {
      const found = state.sessions.find((s) => s.id === id);
      return found ? { ...found } : null;
    },
    updateSession: async (session: FakeSession) => {
      state.updates.push({ id: session.id, status: session.status });
      const index = state.sessions.findIndex((s) => s.id === session.id);
      if (index >= 0) state.sessions[index] = { ...session };
    },
    listSessions: async () => state.sessions.map((s) => ({ ...s })),
  };
  registerRuntimeCoreApiProvider(
    () => ({ chatManager: { getSessionGateway: () => gateway } }) as never
  );
  return state;
}

/** 一张已过期的工具审批卡（会话侧只关心 id / 类型 / 来源 / metadata） */
function expiredApprovalItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'inbox-expired-1',
    sessionId: 'sess-expiry-1',
    type: 'approval',
    title: '工具审批: bash',
    message: '命令: node -e 1',
    status: 'expired',
    offlineCapable: true,
    source: 'permission',
    metadata: { toolName: 'bash', toolCallId: 'tc-1' },
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

afterEach(() => {
  registerRuntimeCoreApiProvider(undefined);
});

afterAll(() => {
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // Windows：SQLite 句柄可能延迟释放（EBUSY）⇒ 交给系统清理临时目录
  }
});

describe('convergeSessionAfterApprovalExpiry：过期 ⇒ 持久化状态收回 active', () => {
  it('requires_action ⇒ active（只写一次）', async () => {
    const state = stubGateway([
      { id: 'sess-expiry-1', status: SessionStatus.REQUIRES_ACTION },
    ]);

    await convergeSessionAfterApprovalExpiry(expiredApprovalItem());

    expect(state.updates).toEqual([
      { id: 'sess-expiry-1', status: SessionStatus.ACTIVE },
    ]);
  });

  it('登记「审批已过期」持久化标记（前端徽标依据，非字符串匹配）', async () => {
    const state = stubGateway([
      { id: 'sess-expiry-1', status: SessionStatus.REQUIRES_ACTION },
    ]);

    await convergeSessionAfterApprovalExpiry(expiredApprovalItem());

    const meta = state.sessions[0].metadata as
      | { approvalExpiredAt?: number; approvalExpiredInboxId?: string }
      | undefined;
    expect(typeof meta?.approvalExpiredAt).toBe('number');
    expect(meta?.approvalExpiredInboxId).toBe('inbox-expired-1');
  });

  it('幂等：同一张卡再次过期不再落盘', async () => {
    const state = stubGateway([
      { id: 'sess-expiry-1', status: SessionStatus.REQUIRES_ACTION },
    ]);
    const item = expiredApprovalItem();

    await convergeSessionAfterApprovalExpiry(item);
    await convergeSessionAfterApprovalExpiry(item);

    expect(state.updates).toHaveLength(1);
    expect(state.sessions[0].status).toBe(SessionStatus.ACTIVE);
  });

  it('PDCA 步骤卡过期不在本函数收口', async () => {
    const state = stubGateway([
      { id: 'sess-expiry-1', status: SessionStatus.REQUIRES_ACTION },
    ]);

    await convergeSessionAfterApprovalExpiry(
      expiredApprovalItem({
        source: 'pdca',
        metadata: { pdcaTaskId: 'pdca-1', stepId: 'step-1' },
      })
    );

    expect(state.updates).toEqual([]);
    expect(state.sessions[0].status).toBe(SessionStatus.REQUIRES_ACTION);
  });

  it('工作区访问申请过期不按单次调用收口', async () => {
    const state = stubGateway([
      { id: 'sess-expiry-1', status: SessionStatus.REQUIRES_ACTION },
    ]);

    await convergeSessionAfterApprovalExpiry(
      expiredApprovalItem({
        source: 'permission',
        metadata: { kind: 'workspace-scope', targetPath: 'e:/tmp' },
      })
    );

    expect(state.updates).toEqual([]);
  });
});

describe('releaseSessionAfterApproval：审批已落定 ⇒ 立刻退出「等待审批」（2026-11-24）', () => {
  it('requires_action 且同会话无其他 pending 审批 ⇒ 收回 active', async () => {
    const state = stubGateway([
      { id: 'sess-expiry-1', status: SessionStatus.REQUIRES_ACTION },
    ]);

    await releaseSessionAfterApproval(
      expiredApprovalItem({ status: 'replied' })
    );

    expect(state.updates).toEqual([
      { id: 'sess-expiry-1', status: SessionStatus.ACTIVE },
    ]);
  });

  it('PDCA 步骤卡 ⇒ 不在本函数收口（由编排器负责）', async () => {
    const state = stubGateway([
      { id: 'sess-expiry-1', status: SessionStatus.REQUIRES_ACTION },
    ]);

    await releaseSessionAfterApproval(
      expiredApprovalItem({
        status: 'replied',
        source: 'pdca',
        metadata: { pdcaTaskId: 'pdca-1', stepId: 'step-1' },
      })
    );

    expect(state.updates).toEqual([]);
  });

  it('已是 active ⇒ 幂等不重复落盘', async () => {
    const state = stubGateway([
      { id: 'sess-expiry-1', status: SessionStatus.ACTIVE },
    ]);

    await releaseSessionAfterApproval(
      expiredApprovalItem({ status: 'replied' })
    );

    expect(state.updates).toEqual([]);
  });
});

describe('normalizeApprovalTtlMs：TTL 配置键解析（默认 30 分钟不变）', () => {
  it('未配置 / 非法 / 非正数 ⇒ 默认 30 分钟', () => {
    for (const raw of [undefined, null, '', 'abc', 0, -5, Number.NaN]) {
      expect(normalizeApprovalTtlMs(raw)).toBe(APPROVAL_TTL_MS);
    }
  });

  it('正数（数字或数字字符串）⇒ 使用配置值', () => {
    expect(normalizeApprovalTtlMs(12345)).toBe(12345);
    expect(normalizeApprovalTtlMs('60000')).toBe(60000);
  });
});

describe('reconcileStuckApprovalSessions：启动期历史遗留对账', () => {
  it('只收回 requires_action 的会话；active 会话不写', async () => {
    const state = stubGateway([
      { id: 'sess-stuck', status: SessionStatus.REQUIRES_ACTION },
      { id: 'sess-active', status: SessionStatus.ACTIVE },
    ]);

    const converged = await reconcileStuckApprovalSessions();

    expect(converged).toBe(1);
    expect(state.updates).toEqual([
      { id: 'sess-stuck', status: SessionStatus.ACTIVE },
    ]);
  });

  it('组合根未注册 ⇒ 安静返回 0（纯单测 / 早启动降级）', async () => {
    registerRuntimeCoreApiProvider(undefined);
    await expect(reconcileStuckApprovalSessions()).resolves.toBe(0);
  });
});
