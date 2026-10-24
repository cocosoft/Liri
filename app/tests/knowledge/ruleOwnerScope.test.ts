// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 租户级 DB（§6.1 / §1.5，2026-10-25 补齐）：`kg_rules` 的**行级隔离**（knowledge 五仓第 1 仓）。
 *
 * 该表此前落在共享本地库且无归属列 ⇒ 租户内两用户的编译产物（规则）互相可见/覆盖。
 * 本文件同时锁三件事：
 *   ① 行为隔离：同租户 ALICE / BOB 的规则互不可见（search / listAll / listBySourceFile /
 *      count / deleteBySource 全链路）；
 *   ② SQL 漏过滤：所有读写 kg_rules 的语句必须带 `owner_key`；
 *   ③ 单例分桶：租户实例按 tenantId 分桶 + 删租户释放 + 构造器不默认解析路径（惰性，
 *      init 时按当前请求身份解析 `resolveTenantDbPath()` —— 定时编译无身份 ⇒ 落 local:local）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getRuleStore,
  resetRuleStoreScopedForTest,
  type UpsertRuleInput,
} from '../../src/knowledge/rule/RuleStore';
import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';

const TENANT = `rule-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const ALICE: Principal = { tenantId: TENANT, userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: TENANT, userId: 'bob', roles: ['user'] };

const dataDir = mkdtempSync(join(tmpdir(), 'knowledge-rules-'));

const as = <T>(principal: Principal, fn: () => T): T =>
  runWithPrincipal(principal, fn);
const store = () => getRuleStore();

/** 规则入参（rule_id 内容派生 ⇒ 两用户互不相同的 id 即互不可见） */
const rule = (id: string, sourceFile: string): UpsertRuleInput => ({
  id,
  kind: 'guideline',
  statement: `${id} 的陈述`,
  triggers: [`${id}-trigger`],
  constraintStrength: 'should',
  appliesTo: [],
  conflictOf: [],
  evidence: { statement: `${id} 原文` },
  domain: 'knowledge',
  sourceFile,
});

beforeAll(() => {
  process.env.LIRI_DATA_DIR = dataDir;
});

afterAll(() => {
  resetRuleStoreScopedForTest();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows：句柄释放滞后 ⇒ 交给系统临时目录清理
  }
});

describe('kg_rules：行级隔离', () => {
  it('同租户两用户的规则互不可见（search / listAll / listBySourceFile / count）', async () => {
    await as(ALICE, () => store().upsert(rule('alice-rule', 'alice.md')));
    await as(BOB, () => store().upsert(rule('bob-rule', 'bob.md')));

    // search：只命中自己的
    expect(
      (await as(ALICE, () => store().search('alice-rule'))).map((r) => r.id)
    ).toEqual(['alice-rule']);
    expect(await as(BOB, () => store().search('alice-rule'))).toEqual([]);
    expect(
      (await as(BOB, () => store().search('bob-rule'))).map((r) => r.id)
    ).toEqual(['bob-rule']);

    // listAll：全表扫描面 = 当前用户
    expect((await as(ALICE, () => store().listAll())).map((r) => r.id)).toEqual(
      ['alice-rule']
    );
    expect((await as(BOB, () => store().listAll())).map((r) => r.id)).toEqual([
      'bob-rule',
    ]);

    // listBySourceFile：他人的来源文件 ⇒ 空
    expect(await as(BOB, () => store().listBySourceFile('alice.md'))).toEqual(
      []
    );
    expect(
      (await as(ALICE, () => store().listBySourceFile('alice.md'))).map(
        (r) => r.id
      )
    ).toEqual(['alice-rule']);

    // count：计数面 = 当前用户
    expect(await as(ALICE, () => store().count())).toBe(1);
    expect(await as(BOB, () => store().count())).toBe(1);
  });

  it('deleteBySource 只删自己的（他人的等同不存在）', async () => {
    // ALICE 删 alice.md ⇒ 只影响自己的行；BOB 的 bob.md 不受波及
    expect(await as(ALICE, () => store().deleteBySource('alice.md'))).toBe(1);
    expect(await as(ALICE, () => store().listAll())).toEqual([]);
    expect((await as(BOB, () => store().listAll())).map((r) => r.id)).toEqual([
      'bob-rule',
    ]);
  });

  it('同一 rule_id（内容派生）跨用户互不覆盖（复合 PK (rule_id, owner_key)）', async () => {
    // 两用户编译相同内容 ⇒ 同 rule_id ⇒ 各占一行，不是"覆盖"
    const sameId = 'guideline:samehash';
    await as(ALICE, () =>
      store().upsert({
        ...rule(sameId, 'shared.md'),
        statement: 'alice 版陈述',
      })
    );
    await as(BOB, () =>
      store().upsert({
        ...rule(sameId, 'shared.md'),
        statement: 'bob 版陈述',
      })
    );

    // 互不见对方；自己那份完整存在
    expect((await as(ALICE, () => store().search(sameId)))[0]?.statement).toBe(
      'alice 版陈述'
    );
    expect((await as(BOB, () => store().search(sameId)))[0]?.statement).toBe(
      'bob 版陈述'
    );

    // 行数：ALICE 只有 sameId 一行（测试 2 已删 alice-rule）；
    // BOB = bob-rule + sameId 两行 ⇒ 同 rule_id 各占一行，而不是被覆盖成 1
    expect(await as(ALICE, () => store().count())).toBe(1);
    expect(await as(BOB, () => store().count())).toBe(2);

    // 各自清理，互不影响
    await as(ALICE, () => store().deleteBySource('shared.md'));
    expect(
      (await as(ALICE, () => store().search(sameId))).map((r) => r.id)
    ).toEqual([]);
    expect(
      (await as(BOB, () => store().search(sameId))).map((r) => r.id)
    ).toEqual([sameId]);
  });
});

describe('门禁：kg_rules 的读写 SQL 不许漏 owner_key；单例按租户分桶', () => {
  it('所有读写带 owner_key；表定义与单例都带归属结构', () => {
    const src = readFileSync(
      new URL('../../src/knowledge/rule/RuleStore.ts', import.meta.url),
      'utf8'
    );

    // 字面量表名 + 以 SELECT/INSERT/UPDATE/DELETE 起头的模板语句
    const templates = [
      ...src.matchAll(/`[^`]*\$\{KG_RULES_TABLE\}[^`]*`/g),
    ].map((m) => m[0]);
    const rowSql = templates.filter((sql) =>
      /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql)
    );

    // 现状 ≥7 条（upsert INSERT / search SELECT / listBySourceFile SELECT /
    // listAll SELECT / deleteBySource SELECT+DELETE / count 两分支）
    expect(rowSql.length).toBeGreaterThanOrEqual(7);

    for (const sql of rowSql) {
      expect(sql).toContain('owner_key');
    }

    // 表定义带归属列（新库 CREATE + 旧库 ALTER 补列）+ 复合 PK
    expect(src).toContain("owner_key TEXT NOT NULL DEFAULT 'local:local'");
    expect(src).toContain('PRIMARY KEY (rule_id, owner_key)');

    // 复合 PK ⇒ upsert 冲突目标含 owner_key（防同 rule_id 跨用户覆盖）；
    // 目标不带括号（模板 `ON CONFLICT(${target})` 负责加括号，防叠成
    // `ON CONFLICT((rule_id, owner_key))` 被 SQLite prepare 拒绝 —— 实测踩坑）
    expect(src).toContain("'rule_id, owner_key'");
    expect(src).not.toContain("'(rule_id, owner_key)'");
    expect(src).toContain('pkIncludesOwner');

    // 构造器不默认解析路径（惰性：init 时按当前身份解析租户库）
    expect(src).not.toContain('constructor(dbPath: string = resolveDbPath())');
    expect(src).toContain('constructor(dbPath?: string)');
    expect(src).toContain(
      'const dbPath = this.dbPath ?? resolveTenantDbPath();'
    );

    // 方法起手 await init()（防 fire-and-forget 播种竞态，根因修 CS05）
    expect(src).toContain('await this.init();');

    // 单例按租户分桶 + 删租户时释放
    expect(src).toContain('scopedInstances');
    expect(src).toContain('resolveTenantDbPath(principal)');
    expect(src).toContain('registerScopedResource(principalKeyOf(principal)');
  });
});
