// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-07 真机：审批卡「加入命令白名单」写入 `tool_rules.json` 后，bash 安全闸仍弹卡
 * —— 权限层与安全闸是两个判定面。本用例锁住工具层使用的查询入口：
 * 规则命中 ⇒ 可折算 `bypassAsk`；读不到规则 ⇒ `false`（fail-closed，不放宽）。
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configManager, getConfigManager } from '@openliri/infra/config';
import { APPROVAL_PAUSE_CONFIG_KEY } from '@openliri/infra/permission/approvalPause';
import { PermissionChecker } from '@openliri/infra/permission/PermissionChecker';
import { RuleManager } from '@openliri/infra/permission/RuleManager';
import { isCallAllowedByPersistedRules } from '@openliri/infra/permission/PermissionManager';
import type { PermissionContext } from '@openliri/infra/permission/types/PermissionContext';
import {
  PermissionBehavior,
  createPermissionRule,
} from '@openliri/infra/permission/types/PermissionRule';

describe('isCallAllowedByPersistedRules', () => {
  it('规则命中 ⇒ true（按工具名 + 入参查询）', () => {
    const checker = {
      isToolAllowed: (
        toolName: string,
        context: { input?: Record<string, unknown> }
      ) =>
        toolName === 'bash' &&
        String(context.input?.['command'] ?? '').startsWith('node -e'),
    };
    expect(
      isCallAllowedByPersistedRules('bash', { command: 'node -e "1"' }, checker)
    ).toBe(true);
    expect(
      isCallAllowedByPersistedRules(
        'bash',
        { command: 'node check.js' },
        checker
      )
    ).toBe(false);
    expect(
      isCallAllowedByPersistedRules(
        'powershell',
        { command: 'node -e "1"' },
        checker
      )
    ).toBe(false);
  });

  it('规则读取抛错 ⇒ false（fail-closed：仅影响是否免审批，不放宽硬拦截）', () => {
    const checker = {
      isToolAllowed: () => {
        throw new Error('permission store unavailable');
      },
    };
    expect(
      isCallAllowedByPersistedRules('bash', { command: 'x' }, checker)
    ).toBe(false);
  });
});

/**
 * F2（2026-11-17）：暂停持久化放行时，规则**不得再折算成免审批**。
 *
 * 缺口现场：bash / powershell 安全闸的 `bypassAsk` 由该入口从规则折算而来，
 * 但调用方没把会话 id / 工作区根传进来 ⇒ 「仅对当前会话 / 当前工作区暂停」
 * 在安全闸这一面失效（暂停会话里照样免审批）。
 */
describe('F2：暂停时规则不再折算成 bypassAsk', () => {
  // 仅部分用例需要临时规则文件；未创建时 `afterEach` 不清理（避免 rmSync 空路径）
  let dir: string | undefined;
  let checker: PermissionChecker;
  let configSpy: ReturnType<typeof spyOn> | undefined;

  const stubPause = (value: unknown) => {
    configSpy = spyOn(getConfigManager(), 'getValue').mockImplementation(((
      key: string
    ) =>
      key === APPROVAL_PAUSE_CONFIG_KEY
        ? value
        : undefined) as unknown as typeof configManager.getValue);
  };

  afterEach(() => {
    configSpy?.mockRestore();
    configSpy = undefined;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('把 sessionId / workspaceRoots 透传给 isToolAllowed', () => {
    let captured: Record<string, unknown> | undefined;
    const fake = {
      isToolAllowed: (_toolName: string, context: PermissionContext) => {
        captured = context as unknown as Record<string, unknown>;
        return true;
      },
    };
    expect(
      isCallAllowedByPersistedRules(
        'bash',
        { command: 'git status' },
        fake,
        ['e:/proj'],
        'sess-1'
      )
    ).toBe(true);
    expect(captured?.['sessionId']).toBe('sess-1');
    expect(captured?.['workspaceRoots']).toEqual(['e:/proj']);
  });

  it('会话暂停 ⇒ 本会话不再免审批；其他会话照旧命中', () => {
    dir = mkdtempSync(join(tmpdir(), 'liri-rule-bypass-'));
    const manager = new RuleManager();
    manager.setRuleSource(join(dir, 'tool_rules.json'));
    manager.loadRules();
    checker = new PermissionChecker(manager);
    manager.addRule(
      createPermissionRule({
        behavior: PermissionBehavior.ALLOW,
        toolName: 'bash',
        contentPattern: '^git status',
        origin: 'approval',
      })
    );

    stubPause({ global: false, sessions: ['sess-1'], workspaces: [] });
    expect(
      isCallAllowedByPersistedRules(
        'bash',
        { command: 'git status' },
        checker,
        [],
        'sess-1'
      )
    ).toBe(false);
    expect(
      isCallAllowedByPersistedRules(
        'bash',
        { command: 'git status' },
        checker,
        [],
        'sess-2'
      )
    ).toBe(true);
  });

  it('工作区暂停 ⇒ 仅在命中根下不再免审批', () => {
    dir = mkdtempSync(join(tmpdir(), 'liri-rule-bypass-ws-'));
    const manager = new RuleManager();
    manager.setRuleSource(join(dir, 'tool_rules.json'));
    manager.loadRules();
    checker = new PermissionChecker(manager);
    manager.addRule(
      createPermissionRule({
        behavior: PermissionBehavior.ALLOW,
        toolName: 'bash',
        contentPattern: '^git status',
        origin: 'approval',
      })
    );

    stubPause({ global: false, sessions: [], workspaces: ['e:/proj'] });
    expect(
      isCallAllowedByPersistedRules(
        'bash',
        { command: 'git status' },
        checker,
        ['E:\\Proj\\'],
        'sess-1'
      )
    ).toBe(false);
    expect(
      isCallAllowedByPersistedRules(
        'bash',
        { command: 'git status' },
        checker,
        ['e:/other'],
        'sess-1'
      )
    ).toBe(true);
  });
});
