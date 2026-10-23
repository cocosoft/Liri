// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * PR-2（2026-10-23）：审批授权维度（工具 + 参数指纹）回归锁。
 *
 * 锁四条：
 *   ① 工具声明 `approvalFingerprint` 后，「始终允许」按声明维度命中（file_write 只按路径）；
 *   ② 未声明工具回退全参数稳定 JSON（与既有 `toolCallApprovalKey` 完全一致，零行为变更）；
 *   ③ `PermissionRule.inputFingerprint` 只按摘要等值匹配；调用方未提供指纹 ⇒ 不匹配（fail-closed）；
 *   ④ deny 恒优先（带指纹的 deny 规则不会被同工具的 allow 规则盖过）。
 */

import { describe, it, expect } from 'bun:test';
import {
  ApprovedCommandRegistry,
  hashApprovalFingerprint,
  isToolCallApproved,
  toolCallApprovalKey,
  getApprovedCommandRegistry,
  hashCommandForExecution,
} from '../../src/permission/ApprovedCommandRegistry.js';
import {
  resolveApprovalFingerprint,
  normalizeApprovalPath,
} from '../../src/permission/approvalFingerprint.js';
import {
  PermissionBehavior,
  createPermissionRule,
  isRuleMatch,
} from '../../src/permission/types/PermissionRule.js';
import { PermissionChecker } from '../../src/permission/PermissionChecker.js';
import { RuleManager } from '../../src/permission/RuleManager.js';

/** 模拟 `file_write` 的声明（只按路径授权，不关心内容） */
const fileWriteLike = {
  name: 'file_write',
  approvalFingerprint(input: Record<string, unknown>): string {
    return `file_write:${normalizeApprovalPath(input.file_path)}`;
  },
};

describe('PR-2：授权维度由工具声明', () => {
  it('同一路径不同内容 ⇒ 指纹相同；不同路径 ⇒ 不同', () => {
    const a = resolveApprovalFingerprint(fileWriteLike, {
      file_path: 'a.md',
      content: 'one',
    });
    const b = resolveApprovalFingerprint(fileWriteLike, {
      file_path: 'a.md',
      content: 'two',
    });
    const c = resolveApprovalFingerprint(fileWriteLike, {
      file_path: 'b.md',
      content: 'one',
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('未声明 approvalFingerprint 的工具 ⇒ 回退全参数稳定 JSON', () => {
    const input = { file_path: 'a.md', content: 'x' };
    expect(resolveApprovalFingerprint('file_write', input)).toBe(
      toolCallApprovalKey('file_write', input)
    );
  });

  it('声明实现抛错 ⇒ 回退全参数指纹（只更严，不放宽）', () => {
    const broken = {
      name: 'weird_tool',
      approvalFingerprint(): string {
        throw new Error('boom');
      },
    };
    const input = { a: 1 };
    expect(resolveApprovalFingerprint(broken, input)).toBe(
      toolCallApprovalKey('weird_tool', input)
    );
  });

  it('路径归一化：分隔符 / 尾部斜杠 / Windows 大小写', () => {
    expect(normalizeApprovalPath('  E:\\PY\\a.md  ')).toBe(
      process.platform === 'win32' ? 'e:/py/a.md' : 'E:/PY/a.md'
    );
  });
});

describe('PR-2：放行缓存按指纹命中', () => {
  it('批准路径 A 后，同路径不同内容命中；路径 B 不命中', () => {
    const sessionId = 'sess-pr2-fp';
    const registry = getApprovedCommandRegistry();

    const fpA = resolveApprovalFingerprint(fileWriteLike, {
      file_path: 'A.md',
      content: 'v1',
    });
    registry.approve(sessionId, hashCommandForExecution(fpA));

    expect(
      isToolCallApproved(
        sessionId,
        'file_write',
        { file_path: 'A.md', content: 'v2' },
        resolveApprovalFingerprint(fileWriteLike, {
          file_path: 'A.md',
          content: 'v2',
        })
      )
    ).toBe(true);
    expect(
      isToolCallApproved(
        sessionId,
        'file_write',
        { file_path: 'B.md', content: 'v1' },
        resolveApprovalFingerprint(fileWriteLike, {
          file_path: 'B.md',
          content: 'v1',
        })
      )
    ).toBe(false);

    registry.clearSession(sessionId);
  });

  it('session 档不随短 TTL 过期（once 档会过期）', async () => {
    const sid = 'sess-pr2-scope';
    // 极小 TTL 的独立实例（autoCleanup=false，避免定时器影响测试）
    const probe = new ApprovedCommandRegistry(1, false);
    probe.approve(sid, 'hash-once', undefined, { scopeKind: 'once' });
    probe.approve(sid, 'hash-session', undefined, { scopeKind: 'session' });
    await new Promise((r) => setTimeout(r, 5));
    expect(probe.isApproved(sid, 'hash-once')).toBe(false);
    expect(probe.isApproved(sid, 'hash-session')).toBe(true);
  });
});

describe('PR-2：inputFingerprint 规则匹配', () => {
  const rule = createPermissionRule({
    behavior: PermissionBehavior.ALLOW,
    toolName: 'file_write',
    inputFingerprint: 'fp-abc',
  });

  it('摘要相等才命中', () => {
    const input = { file_path: 'a.md' };
    expect(
      isRuleMatch(rule, 'file_write', input, { fingerprint: 'fp-abc' })
    ).toBe(true);
    expect(
      isRuleMatch(rule, 'file_write', input, { fingerprint: 'fp-other' })
    ).toBe(false);
  });

  it('调用方未提供指纹 ⇒ 不命中（fail-closed，不得退化为"工具级全放行"）', () => {
    expect(isRuleMatch(rule, 'file_write', { file_path: 'a.md' })).toBe(false);
  });

  it('工具名不符 ⇒ 不命中', () => {
    expect(
      isRuleMatch(
        rule,
        'file_edit',
        { file_path: 'a.md' },
        { fingerprint: 'fp-abc' }
      )
    ).toBe(false);
  });
});

describe('PR-2：权限裁决链（指纹 allow 只放行对应参数）', () => {
  it('同一路径放行，另一路径仍 ask', async () => {
    const ruleManager = new RuleManager();
    const fpA = resolveApprovalFingerprint(fileWriteLike, {
      file_path: 'keep.md',
      content: '',
    });
    ruleManager.addRule(
      createPermissionRule({
        behavior: PermissionBehavior.ALLOW,
        toolName: 'file_write',
        inputFingerprint: hashApprovalFingerprint(fpA),
      })
    );
    const checker = new PermissionChecker(ruleManager);

    const allowed = await checker.checkPermission(
      fileWriteLike as never,
      { file_path: 'keep.md', content: 'new content' },
      {
        sessionId: 's',
        toolName: 'file_write',
        input: { file_path: 'keep.md', content: 'new content' },
      } as never
    );
    expect(allowed.type).toBe('allow');

    const asked = await checker.checkPermission(
      fileWriteLike as never,
      { file_path: 'other.md', content: 'new content' },
      {
        sessionId: 's',
        toolName: 'file_write',
        input: { file_path: 'other.md', content: 'new content' },
      } as never
    );
    expect(asked.type).toBe('ask');
  });

  it('带指纹的 deny 规则恒优先于 allow 规则', async () => {
    const ruleManager = new RuleManager();
    const input = { file_path: 'secret.md', content: '' };
    const fp = resolveApprovalFingerprint(fileWriteLike, input);
    ruleManager.addRule(
      createPermissionRule({
        behavior: PermissionBehavior.ALLOW,
        toolName: 'file_write',
        inputFingerprint: hashApprovalFingerprint(fp),
      })
    );
    ruleManager.addRule(
      createPermissionRule({
        behavior: PermissionBehavior.DENY,
        toolName: 'file_write',
        inputFingerprint: hashApprovalFingerprint(fp),
      })
    );
    const checker = new PermissionChecker(ruleManager);

    const denied = await checker.checkPermission(
      fileWriteLike as never,
      input,
      { sessionId: 's', toolName: 'file_write', input } as never
    );
    expect(denied.type).toBe('deny');
  });
});
