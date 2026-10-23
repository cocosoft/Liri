// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * PR-2（2026-10-23）：`GET /v1/permissions/rules` 的**合并视图**数据源回归锁。
 *
 * 背景（方案 §3.7.2）：工具规则有两条来源 —— 运行期 `tool_rules.json`（可写）与
 * settings `permissions.{allow,ask,deny}`（启动时并入决策上下文）。若列表只返回前者，
 * 用户在 settings 写了 allow、面板却显示"默认" ⇒ UI 与真实决策不一致。
 *
 * 本用例锁：settings 来源的规则被**如实转出**（行为 / 工具名 / 来源齐全），
 * 供 HTTP 层拼进合并视图（`readOnly:true`）。
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { PermissionManager } from '../../src/permission/PermissionManager.js';
import {
  PermissionBehavior,
  PermissionRuleSource,
} from '../../src/permission/types/PermissionRule.js';
import type { RuleMatcherPermissionContext } from '../../src/permission/utils/RuleMatcher.js';

const manager = PermissionManager.getInstance();
const snapshot: RuleMatcherPermissionContext =
  manager.getToolPermissionContext();

afterEach(() => {
  // 还原上下文（单例共享，避免污染同进程其它用例）
  manager.setToolPermissionContext(snapshot);
});

describe('PR-2：settings 来源规则的只读视图', () => {
  it('allow / deny / ask 三档都被转出，且带来源与工具名', () => {
    manager.addRuleString(
      PermissionBehavior.ALLOW,
      PermissionRuleSource.USER_SETTINGS,
      'Bash(npm:*)'
    );
    manager.addRuleString(
      PermissionBehavior.DENY,
      PermissionRuleSource.PROJECT_SETTINGS,
      'Bash(rm:*)'
    );
    manager.addRuleString(
      PermissionBehavior.ASK,
      PermissionRuleSource.LOCAL_SETTINGS,
      'file_write'
    );

    const entries = manager.getSettingsRuleEntries();

    expect(
      entries.some(
        (e) =>
          e.behavior === PermissionBehavior.ALLOW &&
          e.toolName === 'Bash' &&
          e.contentPattern === 'npm:*' &&
          e.source === PermissionRuleSource.USER_SETTINGS
      )
    ).toBe(true);
    expect(
      entries.some(
        (e) =>
          e.behavior === PermissionBehavior.DENY &&
          e.toolName === 'Bash' &&
          e.source === PermissionRuleSource.PROJECT_SETTINGS
      )
    ).toBe(true);
    expect(
      entries.some(
        (e) =>
          e.behavior === PermissionBehavior.ASK &&
          e.toolName === 'file_write' &&
          e.source === PermissionRuleSource.LOCAL_SETTINGS
      )
    ).toBe(true);
  });

  it('无 settings 规则时不臆造条目（空即空）', () => {
    manager.setToolPermissionContext({
      ...snapshot,
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
    } as RuleMatcherPermissionContext);
    expect(manager.getSettingsRuleEntries()).toHaveLength(0);
  });
});
