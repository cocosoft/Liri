/**
 * 批次 1 / A1（2026-11-24）：审批**落地失败**时回滚 `processing → pending`。
 *
 * 现场：`resolveInboxApproval` 先 CAS（pending→processing）抢锁，再 `reply()` 落定；
 * `reply()` 返回空（如并发删除后写空）时直接 `return { kind:'update_failed' }`，
 * 卡永久停在 `processing` —— 既不可回复，也不在原过期扫描（仅 pending）内。
 *
 * 这里以**实例级**方法替换（非模块 mock，遵守 `noModuleMockGate`）驱动该分支：
 * 只依赖 `get` / `tryUpdateStatus` / `reply` 三个方法，提前返回 ⇒ 不触库、不跑副作用。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  inboxManager,
  type InboxItem,
} from '@openliri/service/runtime/InboxManager';
import { resolveInboxApproval } from '@openliri/service/runtime/inboxApproval';

type InboxMethods = Pick<
  typeof inboxManager,
  'get' | 'tryUpdateStatus' | 'reply'
>;

let original: InboxMethods;

beforeEach(() => {
  original = {
    get: inboxManager.get,
    tryUpdateStatus: inboxManager.tryUpdateStatus,
    reply: inboxManager.reply,
  };
});

afterEach(() => {
  Object.assign(inboxManager, original);
});

function fakeItem(status: InboxItem['status']): InboxItem {
  return {
    id: 'inbox-rollback',
    sessionId: 'sess-rollback',
    type: 'approval',
    title: '需要确认',
    message: '运行命令?',
    status,
    offlineCapable: true,
    source: 'test',
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('审批落地失败 ⇒ processing 回滚（批次 1 / A1）', () => {
  it('reply 返回空 ⇒ 卡回到 pending（而非永久 processing）', async () => {
    let status: InboxItem['status'] = 'pending';
    inboxManager.get = async () => fakeItem(status);
    inboxManager.tryUpdateStatus = async (_id, expected, target) => {
      if (status !== expected) return false;
      status = target;
      return true;
    };
    // 模拟落地写空（如抢锁后卡被并发删除）
    inboxManager.reply = async () => null;

    const outcome = await resolveInboxApproval('inbox-rollback', 'approve');

    expect(outcome.kind).toBe('update_failed');
    // 修复前：停在 'processing' ⇒ 此断言失败
    expect(status).toBe('pending');
  });

  it('回滚本身也失败 ⇒ 仍返回 update_failed（不抛错，等同交给超时兜底）', async () => {
    let casCalls = 0;
    inboxManager.get = async () => fakeItem('pending');
    inboxManager.tryUpdateStatus = async (_id, expected) => {
      casCalls += 1;
      // 第 1 次是抢锁（pending→processing）成功；第 2 次回滚失败
      return casCalls === 1 && expected === 'pending';
    };
    inboxManager.reply = async () => null;

    const outcome = await resolveInboxApproval('inbox-rollback', 'approve');

    expect(outcome.kind).toBe('update_failed');
    expect(casCalls).toBe(2);
  });
});
