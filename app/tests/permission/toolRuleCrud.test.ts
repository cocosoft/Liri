// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * R2（2026-11-17）：工具规则 CRUD 的带校验写入。
 *
 * 锁四条约束（治理方案 §11.6）：
 * 1. 同键不同行为 ⇒ **拒绝**（409），`force` 才可「后写为准」；
 * 2. 规则文件损坏 ⇒ **拒绝任何写入**（409，不覆盖最后可用数据）；
 * 3. 审批生成的规则（指纹 / 本工作区信任）**不可编辑**（403），删除即撤销；
 * 4. 重复键（同键同行为）⇒ 409，而不是静默去重。
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type http from 'http';
import { Readable } from 'node:stream';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configManager, getConfigManager } from '@openliri/infra/config';
import { RuleManager } from '@openliri/infra/permission/RuleManager';
import {
  PermissionBehavior,
  type PermissionRule,
} from '@openliri/infra/permission/types/PermissionRule';
import {
  addRuleChecked,
  updateRuleChecked,
  removeRuleChecked,
  importRulesChecked,
  readUserRuleAllowBudget,
  DEFAULT_USER_RULE_ALLOW_BUDGET,
  USER_RULE_ALLOW_BUDGET_KEY,
} from '@openliri/infra/permission/manager/ruleCrud';

import {
  handleAddPermissionRule,
  handleUpdatePermissionRule,
  handleImportPermissionRules,
  buildRulesExport,
} from '../../src/infrastructure/http/handlers/permission-handlers';

describe('R2：规则 CRUD（带校验写入）', () => {
  let dir: string;
  let file: string;
  let manager: RuleManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'liri-rule-crud-'));
    file = join(dir, 'tool_rules.json');
    manager = new RuleManager();
    manager.setRuleSource(file);
    manager.loadRules();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('新增成功：返回规则并落盘', () => {
    const result = addRuleChecked(manager, {
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      contentPattern: '^git ',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rule.toolName).toBe('bash');
    const persisted = JSON.parse(
      readFileSync(file, 'utf8')
    ) as PermissionRule[];
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.id).toBe(result.rule.id);
  });

  it('contentPattern 原样保留（不去空白：`^git ` 不得变成 `^git`）', () => {
    const result = addRuleChecked(manager, {
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      contentPattern: '^git ',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rule.contentPattern).toBe('^git ');
  });

  it('同键同行为 ⇒ duplicate（不静默去重）', () => {
    const input = {
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      contentPattern: '^git ',
    };
    expect(addRuleChecked(manager, input).ok).toBe(true);

    const second = addRuleChecked(manager, input);
    expect(second).toMatchObject({ ok: false, code: 'duplicate' });
  });

  it('同键不同行为 ⇒ conflict，带出被挡住的规则；force 才「后写为准」', () => {
    expect(
      addRuleChecked(manager, {
        behavior: PermissionBehavior.ALLOW,
        toolName: 'bash',
        contentPattern: '^git ',
      }).ok
    ).toBe(true);

    const denied = addRuleChecked(manager, {
      behavior: PermissionBehavior.DENY,
      toolName: 'bash',
      contentPattern: '^git ',
    });
    expect(denied).toMatchObject({ ok: false, code: 'conflict' });
    if (denied.ok) return;
    expect(denied.conflicts).toHaveLength(1);

    const forced = addRuleChecked(manager, {
      behavior: PermissionBehavior.DENY,
      toolName: 'bash',
      contentPattern: '^git ',
      force: true,
    });
    expect(forced.ok).toBe(true);
    // 后写为准：冲突的 allow 被替换，最终只剩 deny
    expect(manager.getRules().map((rule) => String(rule.behavior))).toEqual([
      'deny',
    ]);
  });

  it('规则文件损坏 ⇒ 拒绝写入且不改动文件（不覆盖最后可用数据）', () => {
    writeFileSync(file, '{ not json');

    const result = addRuleChecked(manager, {
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
    });

    expect(result).toMatchObject({ ok: false, code: 'corrupted' });
    expect(readFileSync(file, 'utf8')).toBe('{ not json');
  });

  it('编辑：改 behavior 保留 id / createdAt，updatedAt 刷新', () => {
    const added = addRuleChecked(manager, {
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      contentPattern: '^git ',
    });
    if (!added.ok) throw new Error('seed failed');

    const updated = updateRuleChecked(manager, added.rule.id, {
      behavior: PermissionBehavior.DENY,
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.rule.id).toBe(added.rule.id);
    expect(String(updated.rule.behavior)).toBe('deny');
    expect(updated.rule.createdAt.getTime()).toBe(
      added.rule.createdAt.getTime()
    );

    const persisted = JSON.parse(
      readFileSync(file, 'utf8')
    ) as PermissionRule[];
    expect(String(persisted[0]!.behavior)).toBe('deny');
  });

  it('编辑：contentPattern=null ⇒ 变成工具级规则', () => {
    const added = addRuleChecked(manager, {
      behavior: PermissionBehavior.ASK,
      toolName: 'bash',
      contentPattern: '^npm ',
    });
    if (!added.ok) throw new Error('seed failed');

    const updated = updateRuleChecked(manager, added.rule.id, {
      contentPattern: null,
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.rule.contentPattern).toBeUndefined();
  });

  it('编辑：审批生成的规则 ⇒ readonly（只可删除撤销）', () => {
    writeFileSync(
      file,
      JSON.stringify([
        {
          id: 'rule_fp',
          behavior: 'allow',
          toolName: 'bash',
          inputFingerprint: 'abc123',
          source: 'ruleStore',
          priority: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ])
    );
    manager.loadRules();

    const result = updateRuleChecked(manager, 'rule_fp', {
      behavior: PermissionBehavior.DENY,
    });
    expect(result).toMatchObject({ ok: false, code: 'readonly' });

    // 但可以删除（= 撤销持久化放行）
    expect(removeRuleChecked(manager, 'rule_fp').ok).toBe(true);
  });

  it('编辑：不存在 ⇒ not-found；改成已存在的键 ⇒ duplicate / conflict', () => {
    expect(
      updateRuleChecked(manager, 'rule_missing', {
        behavior: PermissionBehavior.DENY,
      })
    ).toMatchObject({ ok: false, code: 'not-found' });

    const a = addRuleChecked(manager, {
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      contentPattern: '^a ',
    });
    const b = addRuleChecked(manager, {
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      contentPattern: '^b ',
    });
    if (!a.ok || !b.ok) throw new Error('seed failed');

    expect(
      updateRuleChecked(manager, b.rule.id, { contentPattern: '^a ' })
    ).toMatchObject({ ok: false, code: 'duplicate' });

    // 已有 deny 占住同一键 ⇒ 改过去是 conflict（编辑不支持 force）
    expect(
      addRuleChecked(manager, {
        behavior: PermissionBehavior.DENY,
        toolName: 'bash',
        contentPattern: '^c ',
      }).ok
    ).toBe(true);
    expect(
      updateRuleChecked(manager, a.rule.id, { contentPattern: '^c ' })
    ).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('删除：存在 ⇒ 落盘移除；不存在 ⇒ not-found', () => {
    const added = addRuleChecked(manager, {
      behavior: PermissionBehavior.DENY,
      toolName: 'file_write',
    });
    if (!added.ok) throw new Error('seed failed');

    expect(removeRuleChecked(manager, added.rule.id).ok).toBe(true);
    expect(manager.getRules()).toHaveLength(0);
    expect(removeRuleChecked(manager, added.rule.id)).toMatchObject({
      ok: false,
      code: 'not-found',
    });
  });
});

describe('R2：写接口的参数守卫（不触盘）', () => {
  function makeReq(body: unknown): http.IncomingMessage {
    return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
      headers: {},
    }) as unknown as http.IncomingMessage;
  }

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

  it('POST 带审批字段（inputFingerprint/workspaceRoot）⇒ 400（不允许伪造审批放行）', async () => {
    const { res, captured } = captureRes();
    await handleAddPermissionRule(
      makeReq({
        behavior: 'allow',
        toolName: 'bash',
        inputFingerprint: 'forged',
      }),
      res
    );
    expect(captured.status).toBe(400);
    expect(captured.body).toContain('inputFingerprint');
  });

  it('PUT 改 toolName 或携带 force ⇒ 400（身份稳定 / force 仅用于新增）', async () => {
    const { res, captured } = captureRes();
    await handleUpdatePermissionRule(
      makeReq({ toolName: 'powershell' }),
      res,
      'rule_x'
    );
    expect(captured.status).toBe(400);
    expect(captured.body).toContain('toolName');

    const second = captureRes();
    await handleUpdatePermissionRule(
      makeReq({ behavior: 'deny', force: true }),
      second.res,
      'rule_x'
    );
    expect(second.captured.status).toBe(400);
    expect(second.captured.body).toContain('force');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R2b（2026-11-17）：导入导出 + allow 护栏（危险命令头 / 预算）
// ─────────────────────────────────────────────────────────────────────────────

let configSpy: ReturnType<typeof spyOn> | undefined;

/** 读规则文件（不存在 ⇒ 空数组；用于断言"零写入"） */
function readRulesFile(file: string): PermissionRule[] {
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8')) as PermissionRule[];
}

/** 让 allow 预算返回固定值；其余配置键不 mock（回落原实现） */
function stubAllowBudget(value: unknown): void {
  configSpy = spyOn(getConfigManager(), 'getConfigValue').mockImplementation(((
    key: string
  ) =>
    key === USER_RULE_ALLOW_BUDGET_KEY
      ? value
      : undefined) as unknown as typeof configManager.getConfigValue);
}

function makeReq(body: unknown): http.IncomingMessage {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    headers: {},
  }) as unknown as http.IncomingMessage;
}

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

describe('R2b：危险命令头禁止建 allow', () => {
  let dir: string;
  let file: string;
  let manager: RuleManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'liri-rule-r2b-'));
    file = join(dir, 'tool_rules.json');
    manager = new RuleManager();
    manager.setRuleSource(file);
    manager.loadRules();
  });

  afterEach(() => {
    configSpy?.mockRestore();
    configSpy = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it('deny 词表命令头（rm -rf / git push / dd / mkfs.ext4）⇒ 拒绝建 allow', () => {
    for (const pattern of [
      '^rm -rf',
      '^git push origin main',
      '^dd if=/dev/zero',
      '^mkfs.ext4',
      '^npm install',
    ]) {
      const result = addRuleChecked(manager, {
        behavior: PermissionBehavior.ALLOW,
        toolName: 'bash',
        contentPattern: pattern,
      });
      expect(result).toMatchObject({ ok: false, code: 'dangerous' });
    }
    expect(readRulesFile(file)).toHaveLength(0);
  });

  it('普通只读命令头仍可建 allow', () => {
    for (const pattern of ['^git status', '^git log', '^ls ']) {
      const result = addRuleChecked(manager, {
        behavior: PermissionBehavior.ALLOW,
        toolName: 'bash',
        contentPattern: pattern,
      });
      expect(result.ok).toBe(true);
    }
  });

  it('只有 allow 受限：ask / deny 与"非命令工具"不受命令头约束', () => {
    expect(
      addRuleChecked(manager, {
        behavior: PermissionBehavior.ASK,
        toolName: 'bash',
        contentPattern: '^rm -rf',
      }).ok
    ).toBe(true);
    expect(
      addRuleChecked(manager, {
        behavior: PermissionBehavior.DENY,
        toolName: 'bash',
        contentPattern: '^mkfs',
      }).ok
    ).toBe(true);
    expect(
      addRuleChecked(manager, {
        behavior: PermissionBehavior.ALLOW,
        toolName: 'file_write',
        contentPattern: '^rm -rf',
      }).ok
    ).toBe(true);
  });

  it('编辑成 allow 同样被拦（先建 ask 再改 allow 不能绕过）', () => {
    const seeded = addRuleChecked(manager, {
      behavior: PermissionBehavior.ASK,
      toolName: 'bash',
      contentPattern: '^git push',
    });
    if (!seeded.ok) throw new Error('seed failed');

    expect(
      updateRuleChecked(manager, seeded.rule.id, {
        behavior: PermissionBehavior.ALLOW,
      })
    ).toMatchObject({ ok: false, code: 'dangerous' });
  });
});

describe('R2b：allow 预算', () => {
  let dir: string;
  let file: string;
  let manager: RuleManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'liri-rule-budget-'));
    file = join(dir, 'tool_rules.json');
    manager = new RuleManager();
    manager.setRuleSource(file);
    manager.loadRules();
  });

  afterEach(() => {
    configSpy?.mockRestore();
    configSpy = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it('预算缺失 / 脏值 ⇒ 默认 50；越界也回落默认', () => {
    expect(readUserRuleAllowBudget()).toBe(DEFAULT_USER_RULE_ALLOW_BUDGET);
    stubAllowBudget('50');
    expect(readUserRuleAllowBudget()).toBe(DEFAULT_USER_RULE_ALLOW_BUDGET);
    configSpy?.mockRestore();
    stubAllowBudget(0);
    expect(readUserRuleAllowBudget()).toBe(DEFAULT_USER_RULE_ALLOW_BUDGET);
    configSpy?.mockRestore();
    stubAllowBudget(2);
    expect(readUserRuleAllowBudget()).toBe(2);
  });

  it('allow 达到预算 ⇒ 409 并指向配置项；deny 不受影响', () => {
    stubAllowBudget(2);
    for (const pattern of ['^a ', '^b ']) {
      expect(
        addRuleChecked(manager, {
          behavior: PermissionBehavior.ALLOW,
          toolName: 'bash',
          contentPattern: pattern,
        }).ok
      ).toBe(true);
    }

    const blocked = addRuleChecked(manager, {
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      contentPattern: '^c ',
    });
    expect(blocked).toMatchObject({ ok: false, code: 'budget' });
    if (blocked.ok) return;
    expect(blocked.message).toContain(USER_RULE_ALLOW_BUDGET_KEY);

    expect(
      addRuleChecked(manager, {
        behavior: PermissionBehavior.DENY,
        toolName: 'bash',
        contentPattern: '^d ',
      }).ok
    ).toBe(true);
  });

  it('改内容条件不重复占预算；把 ask 改成 allow 才占预算', () => {
    stubAllowBudget(1);
    const allow = addRuleChecked(manager, {
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      contentPattern: '^a ',
    });
    if (!allow.ok) throw new Error('seed failed');

    expect(
      updateRuleChecked(manager, allow.rule.id, { contentPattern: '^aa ' }).ok
    ).toBe(true);

    const ask = addRuleChecked(manager, {
      behavior: PermissionBehavior.ASK,
      toolName: 'bash',
      contentPattern: '^b ',
    });
    if (!ask.ok) throw new Error('seed failed');
    expect(
      updateRuleChecked(manager, ask.rule.id, {
        behavior: PermissionBehavior.ALLOW,
      })
    ).toMatchObject({ ok: false, code: 'budget' });
  });
});

describe('R2b：规则导入（先全量校验，再一次性落盘）', () => {
  let dir: string;
  let file: string;
  let manager: RuleManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'liri-rule-import-'));
    file = join(dir, 'tool_rules.json');
    manager = new RuleManager();
    manager.setRuleSource(file);
    manager.loadRules();
  });

  afterEach(() => {
    configSpy?.mockRestore();
    configSpy = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it('导入成功：三条全部落盘，contentPattern 原样保留', () => {
    const result = importRulesChecked(manager, [
      { behavior: 'deny', toolName: 'bash', contentPattern: '^rm -rf' },
      { behavior: 'ask', toolName: 'powershell' },
      { behavior: 'allow', toolName: 'bash', contentPattern: '^git status' },
    ]);

    expect(result).toMatchObject({ ok: true, skipped: 0 });
    if (!result.ok) return;
    expect(result.imported).toHaveLength(3);
    expect(result.imported[2]!.contentPattern).toBe('^git status');
    expect(
      JSON.parse(readFileSync(file, 'utf8')) as PermissionRule[]
    ).toHaveLength(3);
  });

  it('重复跳过（含批内重复），不报错', () => {
    expect(
      addRuleChecked(manager, {
        behavior: PermissionBehavior.DENY,
        toolName: 'bash',
        contentPattern: '^rm -rf',
      }).ok
    ).toBe(true);

    const result = importRulesChecked(manager, [
      { behavior: 'deny', toolName: 'bash', contentPattern: '^rm -rf' },
      { behavior: 'ask', toolName: 'bash', contentPattern: '^git ' },
      { behavior: 'ask', toolName: 'bash', contentPattern: '^git ' },
    ]);

    expect(result).toMatchObject({ ok: true, skipped: 2 });
    if (!result.ok) return;
    expect(result.imported).toHaveLength(1);
  });

  it('冲突（同键不同行为）⇒ 409 且零写入', () => {
    expect(
      addRuleChecked(manager, {
        behavior: PermissionBehavior.DENY,
        toolName: 'bash',
        contentPattern: '^git log',
      }).ok
    ).toBe(true);
    const before = readFileSync(file, 'utf8');

    const result = importRulesChecked(manager, [
      { behavior: 'ask', toolName: 'bash', contentPattern: '^ls ' },
      { behavior: 'allow', toolName: 'bash', contentPattern: '^git log' },
    ]);

    expect(result).toMatchObject({ ok: false, code: 'conflict' });
    if (result.ok) return;
    expect(result.conflicts).toHaveLength(1);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('非法条目（缺 toolName / 非法 behavior / 审批字段）⇒ 400 且零写入', () => {
    const cases: unknown[] = [
      [{ behavior: 'allow', toolName: '' }],
      [{ behavior: 'block', toolName: 'bash' }],
      [{ behavior: 'allow', toolName: 'bash', inputFingerprint: 'forged' }],
      [{ behavior: 'allow', toolName: 'bash', contentPattern: 42 }],
      [null],
    ];
    for (const rules of cases) {
      expect(importRulesChecked(manager, rules)).toMatchObject({
        ok: false,
        code: 'invalid',
      });
    }
    expect(importRulesChecked(manager, [])).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(readRulesFile(file)).toHaveLength(0);
  });

  it('导入含危险命令头 allow ⇒ 拒绝且零写入', () => {
    const result = importRulesChecked(manager, [
      { behavior: 'deny', toolName: 'bash', contentPattern: '^ls ' },
      { behavior: 'allow', toolName: 'bash', contentPattern: '^rm -rf' },
    ]);

    expect(result).toMatchObject({ ok: false, code: 'dangerous' });
    expect(readRulesFile(file)).toHaveLength(0);
  });

  it('导入同样受 allow 预算约束（按整批新增数判定）', () => {
    stubAllowBudget(1);
    const result = importRulesChecked(manager, [
      { behavior: 'allow', toolName: 'bash', contentPattern: '^a ' },
      { behavior: 'allow', toolName: 'bash', contentPattern: '^b ' },
    ]);

    expect(result).toMatchObject({ ok: false, code: 'budget' });
    expect(readRulesFile(file)).toHaveLength(0);
  });
});

describe('R2b：导入接口的参数守卫 + 导出载荷', () => {
  afterEach(() => {
    configSpy?.mockRestore();
    configSpy = undefined;
  });

  it('POST /import 缺 rules / 空数组 ⇒ 400', async () => {
    for (const body of [{}, { rules: [] }]) {
      const { res, captured } = captureRes();
      await handleImportPermissionRules(makeReq(body), res);
      expect(captured.status).toBe(400);
    }
  });

  it('导出只含用户手建规则（排除审批卡生成的指纹 / 工作区信任）', () => {
    const now = new Date();
    const rules: PermissionRule[] = [
      {
        id: 'rule_user',
        behavior: PermissionBehavior.ALLOW,
        toolName: 'bash',
        contentPattern: '^git status',
        source: 'ruleStore',
        priority: 1,
        createdAt: now,
        updatedAt: now,
      } as PermissionRule,
      {
        id: 'rule_fp',
        behavior: PermissionBehavior.ALLOW,
        toolName: 'bash',
        inputFingerprint: 'abc123',
        source: 'ruleStore',
        priority: 1,
        createdAt: now,
        updatedAt: now,
      } as PermissionRule,
      {
        id: 'rule_ws',
        behavior: PermissionBehavior.ALLOW,
        toolName: 'file_write',
        workspaceRoot: '/repo',
        source: 'ruleStore',
        priority: 1,
        createdAt: now,
        updatedAt: now,
      } as PermissionRule,
    ];

    const payload = buildRulesExport(rules);

    expect(payload.version).toBe(1);
    expect(payload.rules).toEqual([
      { behavior: 'allow', toolName: 'bash', contentPattern: '^git status' },
    ]);
  });
});
