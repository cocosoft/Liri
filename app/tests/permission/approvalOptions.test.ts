// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * PR-2 审批选项口径（Q-17，2026-10-23）
 *
 * 断言的是**选项与实际能力一致**：
 * - 外部副作用只给「本次 / 本会话 / 拒绝」（不提供永久放行）；
 * - 原先的 `standing_rule` 全仓零消费（客户端无文案映射、审批回复也无处理）⇒ 已摘除，
 *   不得再出现在任何审批卡上（否则等于"点了没反应"的假按钮）。
 *
 * 为什么用 `PermissionChecker` + 无人值守：选项在 `_submitToInbox()` 内构造，
 * 而**交互模式**下由 `PermissionManager` 统一提交（需要规则文件）；
 * 无人值守分支由 checker 自己提交 ⇒ 单测无需落盘规则（零副作用）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { RuleManager } from '../../src/permission/RuleManager.js';
import {
  PermissionChecker,
  setPermissionRuntimeDeps,
} from '../../src/permission/PermissionChecker.js';
import { PermissionDecisionType } from '../../src/permission/types/PermissionDecision.js';

const submitted: Array<Record<string, unknown>> = [];

beforeEach(() => {
  submitted.length = 0;
  setPermissionRuntimeDeps({
    unattendedMode: {
      isUnattended: () => true,
      shouldAutoApprove: () => false,
    },
    inboxManager: {
      submit: async (item: Record<string, unknown>) => {
        submitted.push(item);
        return { id: 'mock-approval', status: 'pending' };
      },
    },
  });
});

afterEach(() => {
  submitted.length = 0;
  // 运行时依赖是**进程级单例**：本文件注入的是"无人值守"桩，必须复位，
  // 否则会串到同进程的其它用例（如 PR-3 会话级 auto-local）。
  setPermissionRuntimeDeps({
    unattendedMode: {
      isUnattended: () => false,
      shouldAutoApprove: () => false,
    },
    inboxManager: {
      submit: async () => ({ id: 'noop' }),
    },
  });
});

function decide(tool: Record<string, unknown>, input: Record<string, unknown>) {
  const checker = new PermissionChecker(new RuleManager());
  return checker.checkPermission(tool as never, input, {
    toolName: tool.name as string,
    input,
    sessionId: 'sess-options',
    workspacePath: process.cwd(),
  } as never);
}

describe('PR-2 审批选项（Q-17）', () => {
  it('外部副作用：只给 本次 / 本会话 / 拒绝，不含 standing_rule', async () => {
    const decision = await decide(
      { name: 'web_fetch_like', riskClass: 'external' },
      { url: 'https://example.com' }
    );

    expect(decision.type).toBe(PermissionDecisionType.ASK);
    expect(submitted).toHaveLength(1);
    const options = submitted[0].options as string[];
    expect(options).toEqual(['approve', 'approve_session', 'deny']);
    expect(options).not.toContain('standing_rule');
  });

  it('本地写：仍保留「始终允许」（allowlist_call），且不含 standing_rule', async () => {
    await decide(
      { name: 'file_write_like', riskClass: 'write' },
      { path: 'a.txt' }
    );

    expect(submitted).toHaveLength(1);
    const options = submitted[0].options as string[];
    expect(options).toContain('allowlist_call');
    expect(options).not.toContain('standing_rule');
  });
});
