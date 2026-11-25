/**
 * 2026-11-25：审批回复的**受理校验**（真机发现的授权放大链路）。
 *
 * 现场：`file_write` 卡（无 `metadata.command`）回 `allowlist_command` ⇒
 * `persistAllowlistRule` 取不到命令文本 ⇒ `contentPattern=undefined` ⇒
 * 落成**无条件整工具 allow**（`file_write` 全放行）。
 *
 * 修复：`resolveInboxApproval` 在 CAS 之前校验「词表 + 该档位必需的前置数据」，
 * 不合法 ⇒ `invalid_reply`（卡片保持 pending，不写任何规则）。
 * 同时 `resolveAllowlistWriteTarget` 保证命令级缺失命令文本时降级指纹或跳过。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  inboxManager,
  type InboxItem,
} from '@openliri/service/runtime/InboxManager';
import {
  resolveAllowlistWriteTarget,
  resolveInboxApproval,
} from '@openliri/service/runtime/inboxApproval';

type InboxMethods = Pick<
  typeof inboxManager,
  'get' | 'tryUpdateStatus' | 'reply'
>;

let original: InboxMethods;
let casCalls = 0;
let replyCalls = 0;

beforeEach(() => {
  original = {
    get: inboxManager.get,
    tryUpdateStatus: inboxManager.tryUpdateStatus,
    reply: inboxManager.reply,
  };
  casCalls = 0;
  replyCalls = 0;
});

afterEach(() => {
  Object.assign(inboxManager, original);
});

function fakeItem(metadata?: Record<string, unknown>): InboxItem {
  return {
    id: 'inbox-validation',
    sessionId: 'sess-validation',
    type: 'approval',
    title: '工具审批',
    message: '请求执行',
    status: 'pending',
    offlineCapable: true,
    source: 'permission',
    ...(metadata ? { metadata } : {}),
    createdAt: 1,
    updatedAt: 1,
  };
}

/** 打桩：CAS 恒成功；`reply` 返回 null（提前返回，不触发规则持久化等副作用） */
function stubPendingCard(metadata?: Record<string, unknown>): void {
  inboxManager.get = async () => fakeItem(metadata);
  inboxManager.tryUpdateStatus = async () => {
    casCalls += 1;
    return true;
  };
  inboxManager.reply = async () => {
    replyCalls += 1;
    return null;
  };
}

describe('审批回复受理校验（越界值不落定）', () => {
  it('未知回复词 ⇒ invalid_reply，不抢锁、不落定', async () => {
    stubPendingCard({ toolName: 'bash', command: 'echo hi' });

    const outcome = await resolveInboxApproval(
      'inbox-validation',
      'yes-please'
    );

    expect(outcome.kind).toBe('invalid_reply');
    expect(casCalls).toBe(0);
    expect(replyCalls).toBe(0);
  });

  it('allowlist_command 但卡上没有命令文本 ⇒ invalid_reply（防整工具放行）', async () => {
    stubPendingCard({
      toolName: 'file_write',
      approvalFingerprintHash: 'fp-1',
    });

    const outcome = await resolveInboxApproval(
      'inbox-validation',
      'allowlist_command'
    );

    expect(outcome.kind).toBe('invalid_reply');
    if (outcome.kind === 'invalid_reply') {
      expect(outcome.reason).toContain('命令文本');
    }
    expect(casCalls).toBe(0);
    expect(replyCalls).toBe(0);
  });

  it('allowlist_call 但缺参数指纹 ⇒ invalid_reply', async () => {
    stubPendingCard({ toolName: 'file_write' });

    const outcome = await resolveInboxApproval(
      'inbox-validation',
      'allowlist_call'
    );

    expect(outcome.kind).toBe('invalid_reply');
    expect(casCalls).toBe(0);
  });

  it('allowlist_command + 有命令文本 ⇒ 正常落定流程（非 invalid_reply）', async () => {
    stubPendingCard({ toolName: 'bash', command: 'python -c "print(1)"' });

    const outcome = await resolveInboxApproval(
      'inbox-validation',
      'allowlist_command'
    );

    expect(outcome.kind).toBe('update_failed');
    // 1 次抢锁（pending→processing）+ 1 次落地失败回滚（processing→pending）
    expect(casCalls).toBe(2);
    expect(replyCalls).toBe(1);
  });

  it('deny 属合法拒绝档 ⇒ 正常落定流程', async () => {
    stubPendingCard({ toolName: 'bash', command: 'echo hi' });

    const outcome = await resolveInboxApproval('inbox-validation', 'deny');

    expect(outcome.kind).toBe('update_failed');
    expect(replyCalls).toBe(1);
  });
});

describe('resolveAllowlistWriteTarget（落点解析）', () => {
  it('命令级 + 有命令 ⇒ 写命令级规则', () => {
    const target = resolveAllowlistWriteTarget(
      { toolName: 'bash', command: 'python -c "print(1)"' },
      true
    );
    expect(target.kind).toBe('command');
  });

  it('命令级 + 无命令 + 有指纹 ⇒ 降级为参数指纹', () => {
    const target = resolveAllowlistWriteTarget(
      { toolName: 'file_write', approvalFingerprintHash: 'fp-1' },
      true
    );
    expect(target.kind).toBe('fingerprint');
  });

  it('命令级 + 无命令 + 无指纹 ⇒ skip（不写整工具放行）', () => {
    const target = resolveAllowlistWriteTarget(
      { toolName: 'file_write' },
      true
    );
    expect(target.kind).toBe('skip');
  });

  it('工具级（allowlist_tool）⇒ 保持整工具放行语义', () => {
    const target = resolveAllowlistWriteTarget({ toolName: 'bash' }, false);
    expect(target.kind).toBe('tool');
  });

  it('缺 toolName ⇒ skip', () => {
    const target = resolveAllowlistWriteTarget({ command: 'echo hi' }, true);
    expect(target.kind).toBe('skip');
  });
});
