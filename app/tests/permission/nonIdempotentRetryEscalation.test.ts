// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * R07-3（2026-10-07）：非幂等工具「重试」⇒ 权限升级守卫
 *
 * 锁四件事（对应 spec `.trae/specs/non-idempotent-retry-approval.md` 的 D2/D4 与 §5-P3）：
 *   ① 本该**放行**（default 模式无规则 ⇒ 默认 allow）的调用，带 `forceAskReason` ⇒ **升级为 ask**
 *      并走既有 Inbox 提交通路（`submittedToInbox:true`）；
 *   ② 不传 `forceAskReason` ⇒ 仍 allow（对照 ⇒ 零行为变更）；
 *   ③ `deny` **不被覆盖**（只升级 allow ⇒ 安全姿态单调，D4）；
 *   ④ `bypass` / `dontAsk`（用户/自动化显式"不要打断"）**不注入 ask**（D2）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { createPermissionManager } from '../../src/permission/PermissionManager.js';
import { PermissionMode } from '../../src/permission/PermissionMode.js';
import { PermissionBehavior } from '../../src/permission/types/PermissionRule.js';
import { inboxManager } from '../../src/runtime/InboxManager.js';
import { unattendedMode } from '../../src/runtime/UnattendedModeManager.js';
import { resolvePermissionsDir } from '../../src/core/paths.js';
// D-126 起 `permission/*` 的 runtime 依赖为**入口注入**；测试绕过入口 ⇒ 显式注入
// （`app/tests/**` 不在门禁扫描根 `app/src` 内，此处跨层导入不触发架构规则）
import { setPermissionRuntimeDeps } from '../../src/permission/PermissionChecker.js';

/** 权限规则持久化文件（`addRule` 会写盘 ⇒ 前后备份/恢复隔离） */
const RULE_FILE = join(resolvePermissionsDir(), 'tool_rules.json');
let rulesBackup: string | null = null;
let originalSubmit: typeof inboxManager.submit;
let originalIsUnattended: typeof unattendedMode.isUnattended;
let originalShouldAutoApprove: typeof unattendedMode.shouldAutoApprove;

const REASON = "非幂等工具 'bash' 的「重试」需要用户审批";

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
});

describe('R07-3 非幂等重试 ⇒ 权限升级', () => {
  it('① 默认放行 + forceAskReason ⇒ 升级为 ask 并提交 Inbox', async () => {
    const pm = createPermissionManager();
    const r = await pm.checkPermissionForTool(
      'bash',
      { command: 'npm publish' },
      { sessionId: 's1', forceAskReason: REASON }
    );
    expect(r.allowed).toBe(false);
    expect(r.decision?.behavior).toBe('ask');
    expect(r.submittedToInbox).toBe(true);
    // ⚠️ 提交成功时 `reason` 由 Inbox 提交结果**改写**（"'bash' queued in Inbox …"）
    // ⇒ 升级理由本身由 ①b 在关闭提交开关时验证（那里保留原始 ask 决策）。
  });

  it('①b 关闭 Inbox 提交开关 ⇒ 保留升级理由（证明 ask 由本闸产生）', async () => {
    process.env.PERMISSION_INBOX_APPROVAL_ENABLED = '0';
    try {
      const pm = createPermissionManager();
      const r = await pm.checkPermissionForTool(
        'bash',
        { command: 'npm publish' },
        { sessionId: 's1', forceAskReason: REASON }
      );
      expect(r.decision?.behavior).toBe('ask');
      expect(r.submittedToInbox).toBe(false);
      expect(r.reason).toBe(REASON);
    } finally {
      delete process.env.PERMISSION_INBOX_APPROVAL_ENABLED;
    }
  });

  it('② 不传 forceAskReason ⇒ 仍放行（对照，零行为变更）', async () => {
    const pm = createPermissionManager();
    const r = await pm.checkPermissionForTool(
      'bash',
      { command: 'npm publish' },
      { sessionId: 's1' }
    );
    expect(r.allowed).toBe(true);
  });

  it('③ deny 不被覆盖（D4：只升级 allow）', async () => {
    const pm = createPermissionManager();
    pm.addRule(PermissionBehavior.DENY, 'bash');
    const r = await pm.checkPermissionForTool(
      'bash',
      { command: 'npm publish' },
      { sessionId: 's1', forceAskReason: REASON }
    );
    expect(r.allowed).toBe(false);
    expect(r.decision?.behavior).toBe('deny');
  });

  it('④ bypass ⇒ 仍放行；dontAsk ⇒ 不注入 ask（D2）', async () => {
    const bypass = createPermissionManager();
    bypass.setMode(PermissionMode.BYPASS);
    const rb = await bypass.checkPermissionForTool(
      'bash',
      { command: 'npm publish' },
      { sessionId: 's1', forceAskReason: REASON }
    );
    expect(rb.allowed).toBe(true);

    const dontAsk = createPermissionManager();
    dontAsk.setMode(PermissionMode.DONT_ASK);
    const rd = await dontAsk.checkPermissionForTool(
      'bash',
      { command: 'npm publish' },
      { sessionId: 's1', forceAskReason: REASON }
    );
    // 该模式"从不询问" ⇒ 本闸不注入 ask（结论仍由该模式自身给出 allow/deny）
    expect(rd.decision?.behavior).not.toBe('ask');
  });
});
