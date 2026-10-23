// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * PR-1（2026-10-23）：审批放行缓存 / 去重回归锁。
 *
 * 背景：非 shell 工具的批准**从未写入放行缓存**（两条提交路径各断一处），
 * 且提交前不查缓存、Inbox 无去重 ⇒ 「点了批准，下一轮同一调用照样弹」。
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  PermissionChecker,
  setPermissionRuntimeDeps,
} from '../../src/permission/PermissionChecker.js';
import { RuleManager } from '../../src/permission/RuleManager.js';
import {
  getApprovedCommandRegistry,
  hashCommandForExecution,
  isToolCallApproved,
  toolCallApprovalKey,
} from '../../src/permission/ApprovedCommandRegistry.js';

const SESSION = 'sess-pr1';
const submitted: Array<Record<string, unknown>> = [];
let pendingItems: Array<{
  id: string;
  status?: string;
  metadata?: Record<string, unknown>;
}> = [];

beforeEach(() => {
  submitted.length = 0;
  pendingItems = [];
  setPermissionRuntimeDeps({
    unattendedMode: {
      isUnattended: () => false,
      shouldAutoApprove: () => false,
    },
    inboxManager: {
      async submit(item: Record<string, unknown>) {
        submitted.push(item);
        return { id: 'inbox-new' };
      },
      async list() {
        return { items: pendingItems };
      },
    },
  });
});

afterEach(() => {
  // 还原为「无 Inbox / 非无人值守」的安全桩，避免影响同进程其它测试
  setPermissionRuntimeDeps({
    unattendedMode: {
      isUnattended: () => false,
      shouldAutoApprove: () => false,
    },
    inboxManager: {
      async submit() {
        return null;
      },
    },
  });
});

describe('PR-1：非 shell 工具的批准必须落盘', () => {
  it('file_write 的审批卡带 commandHash（与 isToolCallApproved 同键）', async () => {
    const checker = new PermissionChecker(new RuleManager());
    const input = { file_path: 'a.md', content: 'hi' };

    await checker.submitAskToInbox('file_write', input, {
      sessionId: SESSION,
      toolName: 'file_write',
      input,
    } as never);

    expect(submitted).toHaveLength(1);
    const meta = submitted[0].metadata as Record<string, unknown>;
    expect(typeof meta.commandHash).toBe('string');
    expect((meta.commandHash as string).length).toBeGreaterThan(8);

    // 批准后（模拟 inboxApproval 的副作用）同一调用应命中放行缓存
    getApprovedCommandRegistry().approve(SESSION, meta.commandHash as string);
    expect(isToolCallApproved(SESSION, 'file_write', input)).toBe(true);
  });

  it('不同参数 ⇒ 指纹不同（不得张冠李戴）', () => {
    const a = hashCommandForExecution(
      toolCallApprovalKey('file_write', { file_path: 'a.md', content: 'x' })
    );
    const b = hashCommandForExecution(
      toolCallApprovalKey('file_write', { file_path: 'b.md', content: 'x' })
    );
    expect(a).not.toBe(b);
  });
});

describe('PR-1：提交前去重（同指纹复用）', () => {
  it('已存在同指纹的待审批项 ⇒ 复用其 id，不再新建', async () => {
    const input = { file_path: 'dup.md', content: 'x' };
    const approvalHash = hashCommandForExecution(
      toolCallApprovalKey('file_write', input)
    );
    pendingItems = [
      {
        id: 'inbox-existing',
        status: 'pending',
        metadata: { toolName: 'file_write', commandHash: approvalHash },
      },
    ];

    const checker = new PermissionChecker(new RuleManager());
    const decision = await checker.submitAskToInbox('file_write', input, {
      sessionId: SESSION,
      toolName: 'file_write',
      input,
    } as never);

    expect(submitted).toHaveLength(0);
    expect(decision.context?.inboxItemId).toBe('inbox-existing');
    expect(decision.context?.submittedToInbox).toBe(true);
  });
});
