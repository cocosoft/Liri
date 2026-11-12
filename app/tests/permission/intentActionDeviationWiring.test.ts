/**
 * 语义护栏「便宜版」· **接线级**回归（2026-10-21）
 *
 * 与 `intentActionDeviation.test.ts` 分工：那里只测纯函数，这里证「权限层真的接上并返回 ask」。
 * 若 `handleDefault` 里的判定被摘掉、或 `metadata.goalText` 没被使用，本条即变红。
 *
 * 锁四件事：
 *  ① 只读意图 + 写文件 ⇒ **返回 ask**（且理由来自本护栏）；
 *  ② 混合意图（要改）⇒ 仍 allow（对照）；
 *  ③ 无意图文本 ⇒ 仍 allow（零行为变更）；
 *  ④ 逃生开关 `FEATURE_INTENT_ACTION_DEVIATION_GUARD=false` ⇒ 仍 allow。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { createPermissionManager } from '@openliri/infra/permission/PermissionManager';
import { inboxManager } from '@openliri/service/runtime/InboxManager';
import { unattendedMode } from '@openliri/service/runtime/UnattendedModeManager';
import { resolvePermissionsDir } from '@openliri/infra/environment';
import { setPermissionRuntimeDeps } from '@openliri/infra/permission/PermissionChecker';

const RULE_FILE = join(resolvePermissionsDir(), 'tool_rules.json');
let rulesBackup: string | null = null;
let originalSubmit: typeof inboxManager.submit;
let originalIsUnattended: typeof unattendedMode.isUnattended;
let originalShouldAutoApprove: typeof unattendedMode.shouldAutoApprove;

beforeEach(() => {
  if (existsSync(RULE_FILE)) {
    rulesBackup = readFileSync(RULE_FILE, 'utf8');
    rmSync(RULE_FILE);
  } else {
    rulesBackup = null;
  }
  originalSubmit = inboxManager.submit;
  inboxManager.submit = (async () => ({
    id: 'mock-approval',
    status: 'pending',
  })) as unknown as typeof inboxManager.submit;
  originalIsUnattended = unattendedMode.isUnattended;
  originalShouldAutoApprove = unattendedMode.shouldAutoApprove;
  unattendedMode.isUnattended = () => false;
  unattendedMode.shouldAutoApprove = () => false;
  setPermissionRuntimeDeps({ unattendedMode, inboxManager });
  delete process.env.FEATURE_INTENT_ACTION_DEVIATION_GUARD;
});

afterEach(() => {
  if (rulesBackup === null) {
    if (existsSync(RULE_FILE)) rmSync(RULE_FILE);
  } else {
    mkdirSync(dirname(RULE_FILE), { recursive: true });
    writeFileSync(RULE_FILE, rulesBackup);
  }
  inboxManager.submit = originalSubmit;
  unattendedMode.isUnattended = originalIsUnattended;
  unattendedMode.shouldAutoApprove = originalShouldAutoApprove;
  delete process.env.FEATURE_INTENT_ACTION_DEVIATION_GUARD;
});

describe('语义护栏接线：意图-动作偏离 ⇒ 权限层返回 ask', () => {
  it('① 只读意图 + file_write ⇒ ask（理由来自本护栏）', async () => {
    process.env.PERMISSION_INBOX_APPROVAL_ENABLED = '0';
    try {
      const pm = createPermissionManager();
      const r = await pm.checkPermissionForTool(
        'file_write',
        { path: 'a.ts', content: 'x' },
        { sessionId: 's1', metadata: { goalText: '帮我看看这个文件的实现' } }
      );
      expect(r.allowed).toBe(false);
      expect(r.decision?.behavior).toBe('ask');
      expect(r.reason).toContain('意图-动作偏离');
    } finally {
      delete process.env.PERMISSION_INBOX_APPROVAL_ENABLED;
    }
  });

  it('② 混合意图（要修改）⇒ 仍放行（对照）', async () => {
    const pm = createPermissionManager();
    const r = await pm.checkPermissionForTool(
      'file_write',
      { path: 'a.ts', content: 'x' },
      { sessionId: 's1', metadata: { goalText: '看看并修复这个文件' } }
    );
    expect(r.allowed).toBe(true);
  });

  it('③ 无意图文本 ⇒ 仍放行（零行为变更）', async () => {
    const pm = createPermissionManager();
    const r = await pm.checkPermissionForTool(
      'file_write',
      { path: 'a.ts', content: 'x' },
      { sessionId: 's1' }
    );
    expect(r.allowed).toBe(true);
  });

  it('④ 逃生开关关闭 ⇒ 仍放行', async () => {
    process.env.FEATURE_INTENT_ACTION_DEVIATION_GUARD = 'false';
    const pm = createPermissionManager();
    const r = await pm.checkPermissionForTool(
      'file_write',
      { path: 'a.ts', content: 'x' },
      { sessionId: 's1', metadata: { goalText: '帮我看看这个文件的实现' } }
    );
    expect(r.allowed).toBe(true);
  });

  // 2026-11-13（观察期真机）：`cd X && findstr … | more` 这类**结构性只读**检索被本护栏
  // 当成"bash 会变更状态" ⇒ 每查一次弹一张审批卡。只读命令不应触发意图偏离升级。
  it('⑤ 只读意图 + 只读复合 bash（findstr 检索）⇒ 放行（不弹审批）', async () => {
    const pm = createPermissionManager();
    const r = await pm.checkPermissionForTool(
      'bash',
      {
        command: 'cd /d E:\\X && findstr /n /c:"paused" app\\src 2>nul | more',
      },
      { sessionId: 's1', metadata: { goalText: '帮我看看这个文件的实现' } }
    );
    expect(r.allowed).toBe(true);
  });

  it('⑥ 对照：只读意图 + 含写入段 bash ⇒ 仍 ask（护栏保留）', async () => {
    // 关掉 Inbox 审批，隔离出"护栏本身"的判定（否则理由会变成"已提交收件箱"）
    process.env.PERMISSION_INBOX_APPROVAL_ENABLED = '0';
    try {
      const pm = createPermissionManager();
      const r = await pm.checkPermissionForTool(
        'bash',
        { command: 'cd /d E:\\X && del out.txt' },
        { sessionId: 's1', metadata: { goalText: '帮我看看这个文件的实现' } }
      );
      expect(r.allowed).toBe(false);
      expect(r.decision?.behavior).toBe('ask');
      expect(r.reason).toContain('意图-动作偏离');
    } finally {
      delete process.env.PERMISSION_INBOX_APPROVAL_ENABLED;
    }
  });
});
