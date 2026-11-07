// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-07 真机：审批卡「加入命令白名单」写入 `tool_rules.json` 后，bash 安全闸仍弹卡
 * —— 权限层与安全闸是两个判定面。本用例锁住工具层使用的查询入口：
 * 规则命中 ⇒ 可折算 `bypassAsk`；读不到规则 ⇒ `false`（fail-closed，不放宽）。
 */
import { describe, expect, it } from 'bun:test';

import { isCallAllowedByPersistedRules } from '@openliri/infra/permission/PermissionManager';

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
