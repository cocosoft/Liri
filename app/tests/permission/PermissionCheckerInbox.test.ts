// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 工具执行审批链路 P1-2 — 统一 Inbox 提交归属测试
 *
 * 覆盖（P1-2 验收）：
 * - ask 决策 → 统一提交 Inbox（卡片含 sessionId + commandHash），返回 submittedToInbox:true
 * - 配置开关 PERMISSION_INBOX_APPROVAL_ENABLED=0 → 不提交，返回纯 ask 决策
 * - 无规则（默认 allow）→ 不触发提交（危险命令由 BashTool 7 层兜底拦截）
 * - 无 sessionId → 不提交（submittedToInbox:false）
 * - 无人值守模式 ask → 仍提交 Inbox（行为不变）
 *
 * 打桩 inboxManager 单例 submit + unattendedMode 单例方法（不打桩整个模块，
 * 避免破坏 src/runtime/__tests__/ 下的 InboxManager/UnattendedModeManager 测试）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { createPermissionManager } from '../../src/permission/PermissionManager.js';
import { PermissionBehavior } from '../../src/permission/types/PermissionRule.js';
import { inboxManager } from '../../src/runtime/InboxManager.js';
import { unattendedMode } from '../../src/runtime/UnattendedModeManager.js';
import { hashCommandForExecution } from '../../src/permission/ApprovedCommandRegistry.js';
import { resolvePermissionsDir } from '../../src/core/paths.js';

/** 权限规则持久化文件（addRule 会写入磁盘，测试前后备份/恢复隔离） */
const RULE_FILE = join(resolvePermissionsDir(), 'tool_rules.json');
let rulesBackup: string | null = null;

interface SubmittedItem {
  sessionId: string;
  type: string;
  title: string;
  metadata?: Record<string, unknown>;
}

const submittedItems: SubmittedItem[] = [];
let originalSubmit: typeof inboxManager.submit;
let originalIsUnattended: typeof unattendedMode.isUnattended;
let originalShouldAutoApprove: typeof unattendedMode.shouldAutoApprove;

beforeEach(() => {
  // 备份并清空权限规则文件（隔离 addRule 持久化污染）
  if (existsSync(RULE_FILE)) {
    rulesBackup = readFileSync(RULE_FILE, 'utf8');
    rmSync(RULE_FILE);
  } else {
    rulesBackup = null;
  }
  submittedItems.length = 0;
  originalSubmit = inboxManager.submit;
  inboxManager.submit = (async (item: SubmittedItem) => {
    submittedItems.push(item);
    return { id: 'mock-approval', status: 'pending' };
  }) as typeof inboxManager.submit;
  originalIsUnattended = unattendedMode.isUnattended;
  originalShouldAutoApprove = unattendedMode.shouldAutoApprove;
  // 默认交互模式（非无人值守）
  unattendedMode.isUnattended = () => false;
  unattendedMode.shouldAutoApprove = () => false;
});

afterEach(() => {
  // 恢复权限规则文件
  if (rulesBackup === null) {
    if (existsSync(RULE_FILE)) rmSync(RULE_FILE);
  } else {
    mkdirSync(dirname(RULE_FILE), { recursive: true });
    writeFileSync(RULE_FILE, rulesBackup);
  }
  inboxManager.submit = originalSubmit;
  unattendedMode.isUnattended = originalIsUnattended;
  unattendedMode.shouldAutoApprove = originalShouldAutoApprove;
});

describe('PermissionManager 统一 Inbox 提交（P1-2）', () => {
  it('ask 决策 → 统一提交 Inbox（卡片含 commandHash）', async () => {
    const pm = createPermissionManager();
    pm.addRule(PermissionBehavior.ASK, 'bash');
    const result = await pm.checkPermissionForTool(
      'bash',
      { command: 'rm -rf /tmp/abc' },
      { sessionId: 'session-1' }
    );
    expect(result.allowed).toBe(false);
    expect(result.decision?.behavior).toBe('ask');
    expect(result.submittedToInbox).toBe(true);
    // 卡片已提交，携带 sessionId + commandHash（供批准后写放行缓存）
    expect(submittedItems.length).toBe(1);
    expect(submittedItems[0].sessionId).toBe('session-1');
    expect(submittedItems[0].type).toBe('approval');
    expect(submittedItems[0].metadata?.commandHash).toBe(
      hashCommandForExecution('rm -rf /tmp/abc')
    );
  });

  it('配置开关关闭 → 不提交，返回纯 ask 决策', async () => {
    process.env.PERMISSION_INBOX_APPROVAL_ENABLED = '0';
    try {
      const pm = createPermissionManager();
      pm.addRule(PermissionBehavior.ASK, 'bash');
      const result = await pm.checkPermissionForTool(
        'bash',
        { command: 'rm -rf /tmp/abc' },
        { sessionId: 'session-1' }
      );
      expect(result.decision?.behavior).toBe('ask');
      expect(result.submittedToInbox).toBe(false);
      expect(submittedItems.length).toBe(0);
    } finally {
      delete process.env.PERMISSION_INBOX_APPROVAL_ENABLED;
    }
  });

  it('无规则（默认 allow）→ 不触发提交（BashTool 7 层兜底）', async () => {
    const pm = createPermissionManager();
    const result = await pm.checkPermissionForTool(
      'bash',
      { command: 'rm -rf /tmp/abc' },
      { sessionId: 'session-1' }
    );
    expect(result.allowed).toBe(true);
    expect(submittedItems.length).toBe(0);
  });

  it('无 sessionId → 不提交（submittedToInbox:false）', async () => {
    const pm = createPermissionManager();
    pm.addRule(PermissionBehavior.ASK, 'bash');
    const result = await pm.checkPermissionForTool('bash', {
      command: 'rm -rf /tmp/abc',
    });
    expect(result.decision?.behavior).toBe('ask');
    expect(result.submittedToInbox).toBe(false);
    expect(submittedItems.length).toBe(0);
  });

  it('无人值守模式 ask → 仍提交 Inbox（行为不变）', async () => {
    unattendedMode.isUnattended = () => true;
    unattendedMode.shouldAutoApprove = () => false;
    const pm = createPermissionManager();
    pm.addRule(PermissionBehavior.ASK, 'bash');
    const result = await pm.checkPermissionForTool(
      'bash',
      { command: 'rm -rf /tmp/abc' },
      { sessionId: 'session-1' }
    );
    expect(result.submittedToInbox).toBe(true);
    expect(submittedItems.length).toBe(1);
  });
});
