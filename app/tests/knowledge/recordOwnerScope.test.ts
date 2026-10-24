// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 租户级 DB（§6.1 / §1.5，2026-10-25 补齐）：`knowledge_records` 的**行级隔离**
 * （knowledge 五仓第 2 仓）。
 *
 * 该表此前落在共享本地库且无归属列 ⇒ 租户内两用户的编译产物（业务记录）互相可见/覆盖。
 * 本文件同时锁三件事：
 *   ① 行为隔离：同租户 ALICE / BOB 的记录互不可见（search / listBySourceFile /
 *      count / deleteBySource 全链路）；
 *   ② SQL 漏过滤：所有读写 knowledge_records 的语句必须带 `owner_key`；
 *   ③ 单例分桶：租户实例按 tenantId 分桶 + 删租户释放 + 构造器不默认解析路径（惰性，
 *      init 时按当前请求身份解析 `resolveTenantDbPath()`）；
 *   ④ 同 (record_type, record_key) 跨用户互不覆盖（复合 PK + 复合唯一约束含 owner_key）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getRecordStore,
  resetRecordStoreScopedForTest,
  type UpsertRecordInput,
} from '../../src/knowledge/record/RecordStore';
import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';

const TENANT = `record-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const ALICE: Principal = { tenantId: TENANT, userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: TENANT, userId: 'bob', roles: ['user'] };

const dataDir = mkdtempSync(join(tmpdir(), 'knowledge-records-'));

const as = <T>(principal: Principal, fn: () => T): T =>
  runWithPrincipal(principal, fn);
const store = () => getRecordStore();

/** 记录入参（key 内容派生 ⇒ 两用户互不相同的 key 即互不可见） */
const record = (key: string, sourceFile: string): UpsertRecordInput => ({
  type: 'contract',
  key,
  data: { no: key, amount: 100 },
  evidence: { no: `${key} 原文` },
  domain: 'knowledge',
  sourceFile,
});

beforeAll(() => {
  process.env.LIRI_DATA_DIR = dataDir;
});

afterAll(() => {
  resetRecordStoreScopedForTest();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows：句柄释放滞后 ⇒ 交给系统临时目录清理
  }
});

describe('knowledge_records：行级隔离', () => {
  it('同租户两用户的记录互不可见（search / listBySourceFile / count）', async () => {
    await as(ALICE, () => store().upsert(record('alice-001', 'alice.md')));
    await as(BOB, () => store().upsert(record('bob-001', 'bob.md')));

    // search：只命中自己的
    expect(
      (await as(ALICE, () => store().search('alice-001'))).map((r) => r.id)
    ).toEqual(['contract:alice-001']);
    expect(await as(BOB, () => store().search('alice-001'))).toEqual([]);
    expect(
      (await as(BOB, () => store().search('bob-001'))).map((r) => r.id)
    ).toEqual(['contract:bob-001']);

    // listBySourceFile：他人的来源文件 ⇒ 空
    expect(await as(BOB, () => store().listBySourceFile('alice.md'))).toEqual(
      []
    );
    expect(
      (await as(ALICE, () => store().listBySourceFile('alice.md'))).map(
        (r) => r.id
      )
    ).toEqual(['contract:alice-001']);

    // count：计数面 = 当前用户
    expect(await as(ALICE, () => store().count())).toBe(1);
    expect(await as(BOB, () => store().count())).toBe(1);
  });

  it('同一 (record_type, record_key) 跨用户互不覆盖（复合唯一约束含 owner_key）', async () => {
    // 两用户编译相同主键 ⇒ 各占一行，不是"覆盖"
    const sameKey = 'shared-001';
    await as(ALICE, () =>
      store().upsert({
        ...record(sameKey, 'shared.md'),
        data: { no: sameKey, amount: 1 },
      })
    );
    await as(BOB, () =>
      store().upsert({
        ...record(sameKey, 'shared.md'),
        data: { no: sameKey, amount: 2 },
      })
    );

    // 互不见对方；自己那份完整存在
    expect(
      (await as(ALICE, () => store().search(sameKey)))[0]?.data?.amount
    ).toBe(1);
    expect(
      (await as(BOB, () => store().search(sameKey)))[0]?.data?.amount
    ).toBe(2);

    // 行数 = 2（两用户各一行），而不是被覆盖成 1
    expect(await as(ALICE, () => store().count())).toBe(2);
    expect(await as(BOB, () => store().count())).toBe(2);

    // 各自清理，互不影响
    await as(ALICE, () => store().deleteBySource('shared.md'));
    expect(
      (await as(ALICE, () => store().search(sameKey))).map((r) => r.id)
    ).toEqual([]);
    expect(
      (await as(BOB, () => store().search(sameKey))).map((r) => r.id)
    ).toEqual(['contract:shared-001']);
  });

  it('deleteBySource 只删自己的（他人的等同不存在）', async () => {
    // ALICE 删 alice.md（=1）；shared.md 已在上一例被 ALICE 清掉 ⇒ 幂等返回 0；
    // BOB 的 bob.md + shared.md 全程不受波及
    expect(await as(ALICE, () => store().deleteBySource('alice.md'))).toBe(1);
    expect(await as(ALICE, () => store().deleteBySource('shared.md'))).toBe(0);
    expect(await as(ALICE, () => store().listBySourceFile('alice.md'))).toEqual(
      []
    );
    expect(
      (await as(BOB, () => store().listBySourceFile('bob.md'))).map((r) => r.id)
    ).toEqual(['contract:bob-001']);
    expect(
      (await as(BOB, () => store().listBySourceFile('shared.md'))).map(
        (r) => r.id
      )
    ).toEqual(['contract:shared-001']);
  });
});

describe('门禁：knowledge_records 的读写 SQL 不许漏 owner_key；单例按租户分桶', () => {
  it('所有读写带 owner_key；表定义与单例都带归属结构', () => {
    const src = readFileSync(
      new URL('../../src/knowledge/record/RecordStore.ts', import.meta.url),
      'utf8'
    );

    // 字面量表名 + 以 SELECT/INSERT/UPDATE/DELETE 起头的模板语句
    const templates = [...src.matchAll(/`[^`]*\$\{RECORDS_TABLE\}[^`]*`/g)].map(
      (m) => m[0]
    );
    const rowSql = templates.filter((sql) =>
      /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql)
    );

    // 现状 ≥6 条（upsert INSERT / search SELECT / listBySourceFile SELECT /
    // deleteBySource SELECT+DELETE / count 两分支）
    expect(rowSql.length).toBeGreaterThanOrEqual(6);

    for (const sql of rowSql) {
      expect(sql).toContain('owner_key');
    }

    // 表定义带归属列（新库 CREATE + 旧库 ALTER 补列）+ 复合唯一约束
    expect(src).toContain("owner_key TEXT NOT NULL DEFAULT 'local:local'");
    expect(src).toContain('PRIMARY KEY (record_id, owner_key)');
    expect(src).toContain('UNIQUE(record_type, record_key, owner_key)');

    // 复合唯一 ⇒ upsert 冲突目标含 owner_key（防同 (type,key) 跨用户覆盖）；
    // 目标不带括号（模板 `ON CONFLICT(${target})` 负责加括号，防叠成
    // `ON CONFLICT((a, b, c))` 被 SQLite prepare 拒绝 —— RuleStore 仓实测踩坑）
    expect(src).toContain("'record_type, record_key, owner_key'");
    expect(src).not.toContain("'(record_type, record_key, owner_key)'");
    expect(src).toContain('uniqueIncludesOwner');

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
