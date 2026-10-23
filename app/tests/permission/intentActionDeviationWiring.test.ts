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
import { createPermissionManager } from '../../src/permission/PermissionManager.js';
import { inboxManager } from '../../src/runtime/InboxManager.js';
import { unattendedMode } from '../../src/runtime/UnattendedModeManager.js';
import { resolvePermissionsDir } from '@openliri/kernel/paths.js';
import { setPermissionRuntimeDeps } from '../../src/permission/PermissionChecker.js';

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
});
