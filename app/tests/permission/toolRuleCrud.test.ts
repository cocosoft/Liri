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
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type http from 'http';
import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RuleManager } from '@openliri/infra/permission/RuleManager';
import {
  PermissionBehavior,
  type PermissionRule,
} from '@openliri/infra/permission/types/PermissionRule';
import {
  addRuleChecked,
  updateRuleChecked,
  removeRuleChecked,
} from '@openliri/infra/permission/manager/ruleCrud';

import {
  handleAddPermissionRule,
  handleUpdatePermissionRule,
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
