// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * S0（2026-11-26）：权限规则「simulate 与执行同源」对账 + **单一运行时实例**不变量。
 *
 * 真机缺陷（`dev_docs/20261126/权限规则同源修复方案-20261126.md` §1.1 R3/R5/R6）：
 * 同一条内容级 deny 规则，`POST /v1/permissions/rules/simulate` 判 deny，真实执行判 allow。
 * S1 定位结论：根因不是匹配逻辑（两路共用 `handleDefault` / `isRuleMatch`），而是
 * **进程内存在两个 `PermissionManager`** —— 规则 HTTP API（含 simulate）用
 * `PermissionManager.getInstance()`，而工具执行链（`CoreAPIImpl.executeTool` →
 * `chatManager.getPermissionManager()`）用的是 `createPermissionManager()` 新建的另一个实例；
 * 后者的 `RuleManager` 只在 `getRules()` 的 30s 惰性 hash 轮询里刷新 ⇒ 写/删规则后最多滞后 30s。
 *
 * 本文件锁两件事：
 * 1. **判定同源**（同一实例上）：`simulatePermission` 与 `checkPermissionForTool` 对
 *    「同规则 + 同输入」必须给出同一结论（工具级 / 内容级 × deny / ask × 命令类 / 非命令类）；
 * 2. **单一实例**（静态）：生产源码不得再调用 `createPermissionManager()` 另起运行时
 *    —— 多实例即多份规则快照，simulate 与实际执行必然分叉。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PermissionManager } from '@openliri/infra/permission/PermissionManager';
import { RuleManager } from '@openliri/infra/permission/RuleManager';
import type { ToolPermissionResult } from '@openliri/infra/permission/manager/toolPermission';
import {
  PermissionBehavior,
  PermissionRuleSource,
  createPermissionRule,
  type PermissionRule,
} from '@openliri/infra/permission/types/PermissionRule';

/** 对账口径：判定结论三元组（simulate 与执行必须落在同一个上） */
type Decision = 'allow' | 'ask' | 'deny';

/** 执行链结论 → 三元组（`checkPermissionForTool` 的归一化结构） */
function toDecision(result: ToolPermissionResult): Decision {
  if (result.allowed) return 'allow';
  return result.decision?.behavior === 'ask' ? 'ask' : 'deny';
}

interface ParityCase {
  name: string;
  /** 权限档（缺省 `default`；`auto` 档同样必须认内容级规则 —— D3 方案 A） */
  mode?: 'default' | 'auto';
  rule?: {
    behavior: PermissionBehavior;
    toolName: string;
    contentPattern?: string;
  };
  toolName: string;
  input: Record<string, unknown>;
  expected: Decision;
}

/** 对账矩阵（§5.1）：工具级 / 内容级 × deny / ask × 命令类 / 非命令类 */
const PARITY_CASES: ParityCase[] = [
  {
    name: '组1 工具级 deny × 命令类（bash）',
    rule: { behavior: PermissionBehavior.DENY, toolName: 'bash' },
    toolName: 'bash',
    input: { command: 'echo parity' },
    expected: 'deny',
  },
  {
    name: '组1 工具级 deny × 非命令类（file_write）',
    rule: { behavior: PermissionBehavior.DENY, toolName: 'file_write' },
    toolName: 'file_write',
    input: { file_path: 'out.txt', content: 'x' },
    expected: 'deny',
  },
  {
    name: '组2 工具级 ask × 命令类（bash）',
    rule: { behavior: PermissionBehavior.ASK, toolName: 'bash' },
    toolName: 'bash',
    input: { command: 'echo parity' },
    expected: 'ask',
  },
  {
    name: '组2 工具级 ask × 非命令类（file_read）',
    rule: { behavior: PermissionBehavior.ASK, toolName: 'file_read' },
    toolName: 'file_read',
    input: { file_path: 'out.txt' },
    expected: 'ask',
  },
  {
    name: '组3 内容级 deny `.*` × 命令类（bash）',
    rule: {
      behavior: PermissionBehavior.DENY,
      toolName: 'bash',
      contentPattern: '.*',
    },
    toolName: 'bash',
    input: { command: 'echo parity' },
    expected: 'deny',
  },
  {
    name: '组3 内容级 deny `.*` × 非命令类（file_write）',
    rule: {
      behavior: PermissionBehavior.DENY,
      toolName: 'file_write',
      contentPattern: '.*',
    },
    toolName: 'file_write',
    input: { file_path: 'out.txt', content: 'x' },
    expected: 'deny',
  },
  {
    name: '组4 内容级 ask `.*` × 命令类（bash）',
    rule: {
      behavior: PermissionBehavior.ASK,
      toolName: 'bash',
      contentPattern: '.*',
    },
    toolName: 'bash',
    input: { command: 'echo parity' },
    expected: 'ask',
  },
  {
    name: '组4 内容级 ask `.*` × 非命令类（file_read）',
    rule: {
      behavior: PermissionBehavior.ASK,
      toolName: 'file_read',
      contentPattern: '.*',
    },
    toolName: 'file_read',
    input: { file_path: 'out.txt' },
    expected: 'ask',
  },
  {
    name: '组5 内容级 deny 不匹配模式 × 命令类（bash）',
    rule: {
      behavior: PermissionBehavior.DENY,
      toolName: 'bash',
      contentPattern: '^ZZZ$',
    },
    toolName: 'bash',
    input: { command: 'echo parity' },
    expected: 'allow',
  },
  {
    name: '组5 内容级 deny 不匹配模式 × 非命令类（file_write）',
    rule: {
      behavior: PermissionBehavior.DENY,
      toolName: 'file_write',
      contentPattern: '^ZZZ$',
    },
    toolName: 'file_write',
    input: { file_path: 'out.txt', content: 'x' },
    expected: 'allow',
  },
  {
    name: '组6 无规则 × 命令类（bash）',
    toolName: 'bash',
    input: { command: 'echo parity' },
    expected: 'allow',
  },
  {
    name: '组6 无规则 × 非命令类（file_write）',
    toolName: 'file_write',
    input: { file_path: 'out.txt', content: 'x' },
    expected: 'allow',
  },
  // ── D3 方案 A：内容级规则对**全工具**生效，且与档位无关（auto 档同口径）──
  {
    name: '组7 auto 档 · 工具级 deny × 非命令类（file_write）',
    mode: 'auto',
    rule: { behavior: PermissionBehavior.DENY, toolName: 'file_write' },
    toolName: 'file_write',
    input: { file_path: 'out.txt', content: 'x' },
    expected: 'deny',
  },
  {
    name: '组7 auto 档 · 内容级 deny `.*` × 非命令类（file_write）',
    mode: 'auto',
    rule: {
      behavior: PermissionBehavior.DENY,
      toolName: 'file_write',
      contentPattern: '.*',
    },
    toolName: 'file_write',
    input: { file_path: 'out.txt', content: 'x' },
    expected: 'deny',
  },
  {
    name: '组7 auto 档 · 内容级 ask `.*` × 非命令类（file_read）',
    mode: 'auto',
    rule: {
      behavior: PermissionBehavior.ASK,
      toolName: 'file_read',
      contentPattern: '.*',
    },
    toolName: 'file_read',
    input: { file_path: 'out.txt' },
    expected: 'ask',
  },
  {
    name: '组7 auto 档 · 内容级 deny `.*` × 命令类（bash）',
    mode: 'auto',
    rule: {
      behavior: PermissionBehavior.DENY,
      toolName: 'bash',
      contentPattern: '.*',
    },
    toolName: 'bash',
    input: { command: 'echo parity' },
    expected: 'deny',
  },
];

describe('S0：simulate 与执行的判定必须同源（同一实例、同一规则、同一输入）', () => {
  let dir: string;
  let manager: PermissionManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'liri-rule-parity-'));
    manager = new PermissionManager();
    manager.getRuleManager().setRuleSource(join(dir, 'tool_rules.json'));
    manager.getRuleManager().loadRules();
    manager.setToolPermissionContext({
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
    });
    manager.setMode('default');
  });

  afterEach(() => {
    manager.getRuleManager().clearRules();
    rmSync(dir, { recursive: true, force: true });
  });

  for (const testCase of PARITY_CASES) {
    it(`${testCase.name} ⇒ simulate 与执行同为 ${testCase.expected}`, async () => {
      manager.setMode(testCase.mode ?? 'default');
      if (testCase.rule) {
        const rule: PermissionRule = createPermissionRule({
          ...testCase.rule,
          source: PermissionRuleSource.RULE_STORE,
        });
        manager.getRuleManager().addRule(rule);
      }

      const simulated = await manager.simulatePermission({
        toolName: testCase.toolName,
        input: testCase.input,
        mode: testCase.mode ?? 'default',
      });
      const executed = await manager.checkPermissionForTool(
        testCase.toolName,
        testCase.input
      );

      expect(simulated.decision).toBe(testCase.expected);
      expect(toDecision(executed)).toBe(simulated.decision);
    });
  }

  it('内容级 deny 的拒绝依据标为 matchScope=content（不再误标 tool）', async () => {
    manager.getRuleManager().addRule(
      createPermissionRule({
        behavior: PermissionBehavior.DENY,
        toolName: 'file_write',
        contentPattern: '.*',
        source: PermissionRuleSource.RULE_STORE,
      })
    );

    const result = await manager.checkPermissionForTool('file_write', {
      file_path: 'out.txt',
      content: 'x',
    });
    expect(result.denyInfo?.matchScope).toBe('content');
  });

  it('工具级 deny 的拒绝依据仍为 matchScope=tool', async () => {
    manager.getRuleManager().addRule(
      createPermissionRule({
        behavior: PermissionBehavior.DENY,
        toolName: 'file_write',
        source: PermissionRuleSource.RULE_STORE,
      })
    );

    const result = await manager.checkPermissionForTool('file_write', {
      file_path: 'out.txt',
      content: 'x',
    });
    expect(result.denyInfo?.matchScope).toBe('tool');
  });
});

/**
 * 2026-11-26 fail-safe：规则文件是**整份覆盖写**。
 *
 * 真机事故：未加载过该文件的实例（旧影子实例 / 脚本）一触发增删，就把它自己那份（常为空）
 * 快照写回，本机 21 条规则被抹成 `[]`。⇒ 写前必须按文件同步快照。
 */
describe('S2b：写规则前必须基于该文件的快照（防止整份覆盖）', () => {
  let dir: string;
  let shared: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'liri-rule-write-safety-'));
    shared = join(dir, 'tool_rules.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const ruleOf = (pattern: string): PermissionRule =>
    createPermissionRule({
      behavior: PermissionBehavior.DENY,
      toolName: 'bash',
      contentPattern: pattern,
      source: PermissionRuleSource.RULE_STORE,
    });

  it('未 loadRules 的实例 addRule ⇒ 不覆盖他人的规则', () => {
    const loaded = new RuleManager();
    loaded.setRuleSource(shared);
    loaded.loadRules();
    loaded.addRule(ruleOf('^a$'));

    // 影子实例：构造后从未读过该文件（本次事故的形态）
    const shadow = new RuleManager();
    shadow.setRuleSource(shared);
    shadow.addRule(ruleOf('^b$'));

    const onDisk = JSON.parse(readFileSync(shared, 'utf8')) as PermissionRule[];
    expect(onDisk.map((r) => r.contentPattern).sort()).toEqual(['^a$', '^b$']);
  });

  it('规则文件损坏（读不出来）⇒ 拒绝整份覆盖写，磁盘现状保留', () => {
    const corrupted = '{ not json';
    writeFileSync(shared, corrupted, 'utf8');

    const shadow = new RuleManager();
    shadow.setRuleSource(shared);
    shadow.addRule(ruleOf('^b$'));

    expect(readFileSync(shared, 'utf8')).toBe(corrupted);
  });
});

/**
 * 进程内只允许**一个**权限运行时（2026-11-26 真机根因的守护）。
 *
 * 该不变量由 scripts/lint-permission-single-source.ts 判据⑥承载（生产源码除工厂定义外不得调用
 * createPermissionManager()，负向对照见 permissionSingleSource.test.ts）—— 门禁进 CI，
 * 比单测里的静态扫描更难被绕过；此处不再重复实现同一判据。
 */
