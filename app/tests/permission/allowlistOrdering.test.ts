// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * F2（2026-11-22）：安全白名单**不得越过**用户显式 deny / ask。
 *
 * 背景（二次复查）：`handleDefault` / `handleAuto` 把白名单判定放在函数开头，
 * 早于一切 deny / ask 检查 ⇒ 名字含关键词（`get` / `ls` / `dir` / `cat`）的工具
 * 会静默越过用户 deny。本文件同时锁住关键词匹配口径：按分隔符**整段**匹配，
 * 且外部命名空间工具（`server__tool`）不参与名字猜测。
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RuleManager } from '@openliri/infra/permission/RuleManager';
import { PermissionChecker } from '@openliri/infra/permission/PermissionChecker';
import { DenialTracker } from '@openliri/infra/permission/trackers/DenialTracker';
import {
  PermissionBehavior,
  createPermissionRule,
} from '@openliri/infra/permission/types/PermissionRule';
import { PermissionDecisionType } from '@openliri/infra/permission/types/PermissionDecision';
import type { PermissionContext } from '@openliri/infra/permission/types/PermissionContext';
import type { ModeHandlerDeps } from '../../../packages/infra/src/permission/manager/modeHandlers';
import {
  handleAuto,
  handleDefault,
} from '../../../packages/infra/src/permission/manager/modeHandlers';
import { AutoModeClassifier } from '../../../packages/infra/src/permission/classifiers/AutoModeClassifier';

let dir: string;
let manager: RuleManager;

const context = { sessionId: 's-f2' } as PermissionContext;

function buildDeps(allowlisted: (name: string) => boolean): ModeHandlerDeps {
  const denialTracker = new DenialTracker();
  return {
    ruleManager: manager,
    denialTracker,
    classifierManager: { isAllowlistedTool: allowlisted },
    messages: [],
    defaultBehavior: 'allow',
    permissionChecker: new PermissionChecker(manager),
    checkFineGrainedRules: async () => ({}),
  } as unknown as ModeHandlerDeps;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'liri-allowlist-'));
  manager = new RuleManager();
  manager.setRuleSource(join(dir, 'tool_rules.json'));
  manager.loadRules();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('F2：白名单顺序', () => {
  it('default 档：白名单命中也不能越过用户 deny', async () => {
    manager.addRule(
      createPermissionRule({
        behavior: PermissionBehavior.DENY,
        toolName: 'budget_set',
        origin: 'user',
      })
    );

    const decision = await handleDefault(
      buildDeps((name) => name === 'budget_set'),
      'budget_set',
      {},
      context
    );

    expect(decision.type).toBe(PermissionDecisionType.DENY);
  });

  it('default 档：白名单命中也不能越过用户 ask', async () => {
    manager.addRule(
      createPermissionRule({
        behavior: PermissionBehavior.ASK,
        toolName: 'budget_set',
        origin: 'user',
      })
    );

    const decision = await handleDefault(
      buildDeps((name) => name === 'budget_set'),
      'budget_set',
      {},
      context
    );

    expect(decision.type).toBe(PermissionDecisionType.ASK);
  });

  it('auto 档：白名单命中也不能越过用户 deny', async () => {
    manager.addRule(
      createPermissionRule({
        behavior: PermissionBehavior.DENY,
        toolName: 'budget_set',
        origin: 'user',
      })
    );

    const decision = await handleAuto(
      buildDeps((name) => name === 'budget_set'),
      'budget_set',
      {},
      context
    );

    expect(decision.type).toBe(PermissionDecisionType.DENY);
  });

  it('无 deny / ask 时白名单仍免审批', async () => {
    const decision = await handleDefault(
      buildDeps((name) => name === 'budget_set'),
      'budget_set',
      {},
      context
    );

    expect(decision.type).toBe(PermissionDecisionType.ALLOW);
    expect(decision.reason).toContain('safe allowlist');
  });
});

describe('F2：白名单关键词口径', () => {
  const classifier = new AutoModeClassifier();

  it('名字里偶然包含关键词（budget / widget）不再命中', () => {
    expect(classifier.isAllowlistedTool('budget_set')).toBe(false);
    expect(classifier.isAllowlistedTool('widget_create')).toBe(false);
  });

  it('外部命名空间工具不参与名字猜测', () => {
    expect(classifier.isAllowlistedTool('srv__get_secret')).toBe(false);
    expect(classifier.isAllowlistedTool('srv__read_file')).toBe(false);
  });

  it('按段命中的只读工具仍免审批', () => {
    expect(classifier.isAllowlistedTool('read')).toBe(true);
    expect(classifier.isAllowlistedTool('tool_search')).toBe(true);
  });
});
