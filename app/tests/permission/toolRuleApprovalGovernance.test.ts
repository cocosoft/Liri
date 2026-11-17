// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * R3（2026-11-17）：审批生成规则治理（治理方案 §3.4）。
 *
 * 锁四件事：
 * 1. **来源侧**：`origin='approval'` 与旧版形态（指纹 / 工作区根）都算审批生成 ⇒ 只读；
 * 2. **分组字段**：序列化带 `origin/approvedAt/approvedBy/hitCount`，未落库的如实为 null；
 * 3. **撤销清缓存**：删除审批规则时按 `approvalCommandHash` 清会话放行缓存；
 * 4. **暂停开关**：开启后审批规则不参与判定（规则仍在列表里，可撤销），且写接口可切换。
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type http from 'http';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configManager, getConfigManager } from '@openliri/infra/config';
import { RuleManager } from '@openliri/infra/permission/RuleManager';
import {
  ApprovedCommandRegistry,
  getApprovedCommandRegistry,
} from '@openliri/infra/permission/ApprovedCommandRegistry';
import {
  PermissionBehavior,
  PermissionRuleSource,
  createPermissionRule,
  isApprovalOriginatedRule,
  resolveRuleOrigin,
  type PermissionRule,
} from '@openliri/infra/permission/types/PermissionRule';
import {
  countUserAllowRules,
  removeRuleChecked,
} from '@openliri/infra/permission/manager/ruleCrud';
import { APPROVAL_PAUSE_CONFIG_KEY } from '@openliri/infra/permission/approvalPause';
import { PermissionChecker } from '@openliri/infra/permission/PermissionChecker';
import type { PermissionContext } from '@openliri/infra/permission/types/PermissionContext';
import { PermissionDecisionType } from '@openliri/infra/permission/types/PermissionDecision';

import {
  serializeRule,
  buildRulesExport,
  handleSetApprovalPause,
} from '../../src/infrastructure/http/handlers/permission-handlers';

let configSpy: ReturnType<typeof spyOn> | undefined;

function captureRes(): {
  res: http.ServerResponse;
  captured: { status: number; body: string };
} {
  const captured = { status: 0, body: '' };
  const res = {
    writeHead(status: number) {
      captured.status = status;
    },
    end(body?: string) {
      captured.body = body ?? '';
    },
  } as unknown as http.ServerResponse;
  return { res, captured };
}

function makeReq(body: unknown): http.IncomingMessage {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    headers: {},
  }) as unknown as http.IncomingMessage;
}

afterEach(() => {
  configSpy?.mockRestore();
  configSpy = undefined;
});

/** 把暂停配置读值替换为任意形状（布尔 / `{global, sessions}`） */
function stubPauseConfig(value: unknown): void {
  configSpy = spyOn(getConfigManager(), 'getValue').mockImplementation(((
    key: string
  ) =>
    key === APPROVAL_PAUSE_CONFIG_KEY
      ? value
      : undefined) as unknown as typeof configManager.getValue);
}

describe('R3：规则来源侧与分组字段', () => {
  it('显式 origin 优先；旧规则按匹配条件推导（不臆造）', () => {
    expect(resolveRuleOrigin({ origin: 'approval' })).toBe('approval');
    expect(resolveRuleOrigin({ origin: 'user', inputFingerprint: 'abc' })).toBe(
      'user'
    );
    expect(resolveRuleOrigin({ inputFingerprint: 'abc' })).toBe('approval');
    expect(resolveRuleOrigin({ workspaceRoot: '/repo' })).toBe('approval');
    expect(resolveRuleOrigin({ contentPattern: '^git ' })).toBe('user');
  });

  it('origin=approval 的普通白名单规则同样只读（旧数据无法区分，旧版仍是 user）', () => {
    const approvalAllow = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      contentPattern: '^git ',
      origin: 'approval',
      approvedAt: new Date(),
    });
    expect(isApprovalOriginatedRule(approvalAllow)).toBe(true);

    const legacyAllow = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      contentPattern: '^git ',
    });
    expect(isApprovalOriginatedRule(legacyAllow)).toBe(false);
  });

  it('序列化带分组字段：approvedAt 回落 createdAt；approvedBy 如实 null；hitCount 来自命中计数', () => {
    const createdAt = new Date('2026-11-17T00:00:00.000Z');
    const approvedAt = new Date('2026-11-17T01:00:00.000Z');
    const approvalRule: PermissionRule = {
      ...createPermissionRule({
        behavior: PermissionBehavior.ALLOW,
        toolName: 'bash',
        inputFingerprint: 'abc123',
        origin: 'approval',
        approvedAt,
      }),
      source: PermissionRuleSource.RULE_STORE,
      createdAt,
      updatedAt: createdAt,
    };

    const serialized = serializeRule(approvalRule);
    expect(serialized['origin']).toBe('approval');
    expect(serialized['approvedAt']).toBe(approvedAt.toISOString());
    expect(serialized['approvedBy']).toBeNull();
    // R5：命中计数来自规则命中统计；随机 id 必然未命中 ⇒ 0 / null
    expect(serialized['hitCount']).toBe(0);
    expect(serialized['lastHitAt']).toBeNull();
    expect(serialized['readOnly']).toBe(true);

    // 旧审批规则（无 approvedAt）⇒ 回落 createdAt
    const legacy = { ...approvalRule, approvedAt: undefined };
    expect(serializeRule(legacy)['approvedAt']).toBe(createdAt.toISOString());

    // 用户规则：审批分组字段一律 null
    const userRule = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'file_read',
      origin: 'user',
    });
    const userSerialized = serializeRule(userRule);
    expect(userSerialized['origin']).toBe('user');
    expect(userSerialized['approvedAt']).toBeNull();
    expect(userSerialized['approvedBy']).toBeNull();
  });

  it('导出与 allow 预算都排除审批生成规则（含 origin 白名单放行）', () => {
    const approvalAllow = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      contentPattern: '^git ',
      origin: 'approval',
    });
    const userAllow = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      contentPattern: '^npm run ',
    });
    const userDeny = createPermissionRule({
      behavior: PermissionBehavior.DENY,
      toolName: 'bash',
      contentPattern: '^rm ',
    });

    const rules = [approvalAllow, userAllow, userDeny];
    expect(buildRulesExport(rules).rules).toEqual([
      { behavior: 'allow', toolName: 'bash', contentPattern: '^npm run ' },
      { behavior: 'deny', toolName: 'bash', contentPattern: '^rm ' },
    ]);
    expect(countUserAllowRules(rules)).toBe(1);
  });
});

describe('R3：撤销审批规则时清会话放行缓存', () => {
  let dir: string;
  let manager: RuleManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'liri-rule-r3-'));
    manager = new RuleManager();
    manager.setRuleSource(join(dir, 'tool_rules.json'));
    manager.loadRules();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('revokeByCommandHash 跨会话清掉同命令条目，其他条目保留', () => {
    const registry = new ApprovedCommandRegistry(60_000, false);
    registry.approve('s1', 'hash-a', 'git status');
    registry.approve('s2', 'hash-a', 'git status');
    registry.approve('s1', 'hash-b', 'npm run build');

    expect(registry.revokeByCommandHash('hash-a')).toBe(2);
    expect(registry.isApproved('s1', 'hash-a')).toBe(false);
    expect(registry.isApproved('s2', 'hash-a')).toBe(false);
    expect(registry.isApproved('s1', 'hash-b')).toBe(true);
    registry.dispose();
  });

  it('删除审批规则 ⇒ 同时清放行缓存；普通规则删除不触碰缓存', () => {
    // 走生产单例（`removeRuleChecked` 清的就是它）
    const registry = getApprovedCommandRegistry();
    registry.approve('s1', 'hash-target', 'git status');

    const approvalRule = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      inputFingerprint: 'fp-1',
      origin: 'approval',
      approvalCommandHash: 'hash-target',
    });
    manager.addRule(approvalRule);

    try {
      expect(removeRuleChecked(manager, approvalRule.id).ok).toBe(true);
      expect(registry.isApproved('s1', 'hash-target')).toBe(false);
    } finally {
      registry.clearSession('s1');
    }
  });
});

describe('R3：暂停全部持久化放行', () => {
  let dir: string;
  let manager: RuleManager;
  let approvalRule: PermissionRule;
  let userRule: PermissionRule;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'liri-rule-pause-'));
    manager = new RuleManager();
    manager.setRuleSource(join(dir, 'tool_rules.json'));
    manager.loadRules();

    approvalRule = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      contentPattern: '^git ',
      origin: 'approval',
      approvedAt: new Date(),
    });
    userRule = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'file_read',
    });
    manager.addRule(approvalRule);
    manager.addRule(userRule);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function stubPause(enabled: boolean): void {
    configSpy = spyOn(getConfigManager(), 'getValue').mockImplementation(((
      key: string
    ) =>
      key === APPROVAL_PAUSE_CONFIG_KEY
        ? enabled
        : undefined) as unknown as typeof configManager.getValue);
  }

  it('开启 ⇒ 判定读取口过滤审批规则，列表仍可见（可撤销）', () => {
    stubPause(true);
    const allowedIds = manager.getAllowRules().map((rule) => rule.id);
    expect(allowedIds).toEqual([userRule.id]);
    // 治理视图不受影响：规则还在
    expect(manager.getRules().map((rule) => rule.id)).toEqual([
      approvalRule.id,
      userRule.id,
    ]);
  });

  it('关闭（默认）⇒ 审批规则照常参与判定', () => {
    stubPause(false);
    expect(manager.getAllowRules().map((rule) => rule.id)).toEqual([
      approvalRule.id,
      userRule.id,
    ]);
  });

  it('切换接口：enabled 非布尔 ⇒ 400；布尔 ⇒ 200 且写入同一配置键', async () => {
    const bad = captureRes();
    await handleSetApprovalPause(makeReq({ enabled: 'true' }), bad.res);
    expect(bad.captured.status).toBe(400);

    const setValueSpy = spyOn(
      getConfigManager(),
      'setValue'
    ).mockImplementation(
      (() => undefined) as unknown as typeof configManager.setValue
    );
    try {
      const ok = captureRes();
      await handleSetApprovalPause(makeReq({ enabled: true }), ok.res);
      expect(ok.captured.status).toBe(200);
      expect(JSON.parse(ok.captured.body).enabled).toBe(true);
      expect(setValueSpy).toHaveBeenCalledWith(APPROVAL_PAUSE_CONFIG_KEY, true);
    } finally {
      setValueSpy.mockRestore();
    }
  });
});

/**
 * F2（2026-11-17）：暂停粒度细化。
 *
 * 锁四件事：
 * 1. **判定口全覆盖**：命令级（`contentPattern`）审批规则此前直读 `getRules()` 绕过暂停 ⇒
 *    现在所有读取口（allow / deny / ask / 内容级）统一过滤；
 * 2. **按会话**：只对命中会话生效，其他会话与"无会话上下文"的路径不受影响；
 * 3. **列表不受影响**：规则仍可见、可撤销（暂停不是删除）；
 * 4. **写接口**：`{global, sessions}` 整体写入 + 非法入参 400，旧 `{enabled}` 形状兼容。
 */
describe('F2：暂停粒度（全局 / 按会话）', () => {
  let dir: string;
  let manager: RuleManager;
  let checker: PermissionChecker;
  let approvalCommandRule: PermissionRule;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'liri-rule-pause-f2-'));
    manager = new RuleManager();
    manager.setRuleSource(join(dir, 'tool_rules.json'));
    manager.loadRules();
    checker = new PermissionChecker(manager);

    approvalCommandRule = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      contentPattern: 'git status',
      origin: 'approval',
    });
    manager.addRule(approvalCommandRule);
    manager.addRule(
      createPermissionRule({
        behavior: PermissionBehavior.DENY,
        toolName: 'danger_tool',
        origin: 'approval',
      })
    );
    manager.addRule(
      createPermissionRule({
        behavior: PermissionBehavior.ASK,
        toolName: 'ask_tool',
        origin: 'approval',
      })
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const ctx = (sessionId?: string): PermissionContext =>
    ({ toolName: 'bash', sessionId, input: {} }) as PermissionContext;
  const ctxOf = (toolName: string, sessionId?: string): PermissionContext =>
    ({ toolName, sessionId, input: {} }) as PermissionContext;

  it('全局暂停 ⇒ 命令级审批规则不再放行（此前直读 getRules 会绕过过滤）', () => {
    const input = { command: 'git status' };

    stubPauseConfig(false);
    expect(
      checker.checkContentSpecificRules('bash', input, ctx('s1'))?.type
    ).toBe(PermissionDecisionType.ALLOW);

    configSpy?.mockRestore();
    stubPauseConfig(true);
    expect(
      checker.checkContentSpecificRules('bash', input, ctx('s1'))
    ).toBeNull();
  });

  it('按会话暂停 ⇒ 只对命中会话生效；其他会话 / 无会话上下文照常', () => {
    stubPauseConfig({ global: false, sessions: ['s1'] });
    const input = { command: 'git status' };

    expect(
      checker.checkContentSpecificRules('bash', input, ctx('s1'))
    ).toBeNull();
    expect(
      checker.checkContentSpecificRules('bash', input, ctx('s2'))?.type
    ).toBe(PermissionDecisionType.ALLOW);
    // 无会话上下文（后台/无人值守）⇒ 只按 global，不被某个会话的暂停顺带收紧
    expect(
      checker.checkContentSpecificRules('bash', input, ctx(undefined))?.type
    ).toBe(PermissionDecisionType.ALLOW);
  });

  it('审批生成的 deny / ask 规则同样受暂停约束（工具级读取口）', () => {
    stubPauseConfig(true);
    expect(
      checker.isToolDenied('danger_tool', ctxOf('danger_tool', 's1'))
    ).toBe(false);
    expect(checker.isToolAskRequired('ask_tool', ctxOf('ask_tool', 's1'))).toBe(
      false
    );

    configSpy?.mockRestore();
    stubPauseConfig(false);
    expect(
      checker.isToolDenied('danger_tool', ctxOf('danger_tool', 's1'))
    ).toBe(true);
    expect(checker.isToolAskRequired('ask_tool', ctxOf('ask_tool', 's1'))).toBe(
      true
    );
  });

  it('列表视图不受暂停影响（仍可逐条撤销）', () => {
    stubPauseConfig(true);
    expect(manager.getRules().map((rule) => rule.id)).toContain(
      approvalCommandRule.id
    );
  });

  it('写接口：{global, sessions} 整体写入并去重去空白；非法入参 400', async () => {
    const setValueSpy = spyOn(
      getConfigManager(),
      'setValue'
    ).mockImplementation(
      (() => undefined) as unknown as typeof configManager.setValue
    );
    try {
      const ok = captureRes();
      await handleSetApprovalPause(
        makeReq({ global: false, sessions: [' s1 ', '', 's1'] }),
        ok.res
      );
      expect(ok.captured.status).toBe(200);
      expect(JSON.parse(ok.captured.body).sessions).toEqual(['s1']);
      expect(setValueSpy).toHaveBeenCalledWith(APPROVAL_PAUSE_CONFIG_KEY, {
        global: false,
        sessions: ['s1'],
      });

      // 旧形状兼容：只改全局
      const legacy = captureRes();
      await handleSetApprovalPause(makeReq({ enabled: false }), legacy.res);
      expect(legacy.captured.status).toBe(200);
      expect(JSON.parse(legacy.captured.body).enabled).toBe(false);

      const badBodies: unknown[] = [
        {},
        { sessions: 's1' },
        { sessions: [1] },
        { global: 'yes' },
        { sessions: ['x'.repeat(129)] },
      ];
      for (const bad of badBodies) {
        const res = captureRes();
        await handleSetApprovalPause(makeReq(bad), res.res);
        expect(res.captured.status).toBe(400);
      }
    } finally {
      setValueSpy.mockRestore();
    }
  });
});
