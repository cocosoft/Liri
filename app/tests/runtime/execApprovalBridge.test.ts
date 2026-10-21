/**
 * 企业审批流接线（`ExecApprovalManager` ← 工具 ASK）
 *
 * 口径：默认关；开启后把"已提交 Inbox 的工具审批"镜像成企业审批请求，
 * 企业侧批准/拒绝再**回灌 Inbox**（走同一个 `resolveInboxApproval`，CAS 保证单赢）。
 * 企业侧超时/取消**不动 Inbox**（Inbox 自己有过期语义）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import {
  enterpriseStatusToInboxReply,
  isEnterpriseExecApprovalEnabled,
  mirrorAskToEnterpriseApproval,
  __getMirroredApprovalsForTest,
  __resetExecApprovalBridgeForTest,
  type ExecApprovalBridgeDeps,
} from '../../src/runtime/execApprovalBridge.js';
import type {
  ExecApprovalManager,
  ExecApprovalRequest,
  ExecApprovalStatus,
} from '../../src/config/enterprise/audit/ExecApprovalManager.js';

const ENV_KEY = 'LIRI_EXEC_APPROVAL_ENABLED';

const INPUT = {
  inboxItemId: 'inbox-1',
  toolName: 'bash',
  toolInput: { command: 'rm -rf build' },
  requester: 'alice',
  description: '危险命令',
  sessionId: 's-1',
};

function makeDecided(status: ExecApprovalStatus): ExecApprovalRequest {
  return {
    id: 'req-1',
    toolUseId: 'inbox-1',
    toolName: 'bash',
    input: {},
    description: '',
    requester: 'alice',
    status,
    createdAt: 1,
    updatedAt: 2,
    timeoutAt: 3,
    decision: { approvedBy: 'boss', approvedAt: 2 },
  };
}

/** 假审批管理器：同步给 id，按预置状态决出 */
function makeFakeManager(status: ExecApprovalStatus): {
  manager: ExecApprovalManager;
  created: number;
} {
  const counter = { created: 0 };
  const manager = {
    createRequest: () => {
      counter.created += 1;
      return makeDecided('pending');
    },
    waitForDecision: async () => makeDecided(status),
  } as unknown as ExecApprovalManager;
  return { manager, created: counter.created };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  __resetExecApprovalBridgeForTest();
  delete process.env[ENV_KEY];
});

afterEach(() => {
  __resetExecApprovalBridgeForTest();
  delete process.env[ENV_KEY];
});

describe('企业审批开关（默认关）', () => {
  it('未配置 ⇒ 关闭（桌面/CLI 零行为变更）', () => {
    expect(isEnterpriseExecApprovalEnabled()).toBe(false);
  });

  it('环境变量 `LIRI_EXEC_APPROVAL_ENABLED=1` ⇒ 开启', () => {
    process.env[ENV_KEY] = '1';
    expect(isEnterpriseExecApprovalEnabled()).toBe(true);
  });

  it('关闭时镜像直接跳过（不创建企业请求）', () => {
    let created = 0;
    const deps: ExecApprovalBridgeDeps = {
      createManager: () => {
        created += 1;
        return makeFakeManager('approved').manager;
      },
    };
    expect(mirrorAskToEnterpriseApproval(INPUT, deps)).toBeUndefined();
    expect(created).toBe(0);
    expect(__getMirroredApprovalsForTest().size).toBe(0);
  });
});

describe('企业审批状态 → Inbox 回复', () => {
  it('approved ⇒ approve；rejected ⇒ reject；超时/取消 ⇒ null（不动 Inbox）', () => {
    expect(enterpriseStatusToInboxReply('approved')).toBe('approve');
    expect(enterpriseStatusToInboxReply('rejected')).toBe('reject');
    expect(enterpriseStatusToInboxReply('timed_out')).toBeNull();
    expect(enterpriseStatusToInboxReply('cancelled')).toBeNull();
    expect(enterpriseStatusToInboxReply('pending')).toBeNull();
  });
});

describe('镜像与回灌', () => {
  it('开启 ⇒ 创建企业请求并登记镜像关系', () => {
    process.env[ENV_KEY] = '1';
    const { manager } = makeFakeManager('pending');
    const id = mirrorAskToEnterpriseApproval(INPUT, {
      createManager: () => manager,
      resolveInbox: async () => ({ kind: 'ok' }),
      audit: async () => {},
    });
    expect(id).toBe('req-1');
    expect(__getMirroredApprovalsForTest().get('inbox-1')).toBe('req-1');
  });

  it('企业批准 ⇒ 回灌 Inbox（approve）并留审计', async () => {
    process.env[ENV_KEY] = '1';
    const calls: Array<{ id: string; reply: string }> = [];
    const audits: Array<{
      reply: string;
      approvedBy: string;
      outcome: string;
    }> = [];

    mirrorAskToEnterpriseApproval(INPUT, {
      createManager: () => makeFakeManager('approved').manager,
      resolveInbox: async (id, reply) => {
        calls.push({ id, reply });
        return { kind: 'ok' };
      },
      audit: async (a) => {
        audits.push({
          reply: a.reply,
          approvedBy: a.approvedBy,
          outcome: a.outcome,
        });
      },
    });

    await sleep(10);

    expect(calls).toEqual([{ id: 'inbox-1', reply: 'approve' }]);
    expect(audits).toEqual([
      { reply: 'approve', approvedBy: 'boss', outcome: 'ok' },
    ]);
    // 决出后镜像关系清理（避免长期占用）
    expect(__getMirroredApprovalsForTest().size).toBe(0);
  });

  it('企业拒绝 ⇒ 回灌 Inbox（reject）', async () => {
    process.env[ENV_KEY] = '1';
    const calls: string[] = [];

    mirrorAskToEnterpriseApproval(INPUT, {
      createManager: () => makeFakeManager('rejected').manager,
      resolveInbox: async (_id, reply) => {
        calls.push(reply);
        return { kind: 'ok' };
      },
      audit: async () => {},
    });

    await sleep(10);
    expect(calls).toEqual(['reject']);
  });

  it('企业侧超时 ⇒ **不回灌**（Inbox 自行过期），镜像关系被清理', async () => {
    process.env[ENV_KEY] = '1';
    let resolved = 0;
    let audited = 0;

    mirrorAskToEnterpriseApproval(INPUT, {
      createManager: () => makeFakeManager('timed_out').manager,
      resolveInbox: async () => {
        resolved += 1;
        return { kind: 'ok' };
      },
      audit: async () => {
        audited += 1;
      },
    });

    await sleep(10);
    expect(resolved).toBe(0);
    expect(audited).toBe(0);
    expect(__getMirroredApprovalsForTest().size).toBe(0);
  });

  it('缺 inboxItemId ⇒ 不镜像', () => {
    process.env[ENV_KEY] = '1';
    expect(
      mirrorAskToEnterpriseApproval(
        { ...INPUT, inboxItemId: undefined },
        { createManager: () => makeFakeManager('approved').manager }
      )
    ).toBeUndefined();
  });
});
