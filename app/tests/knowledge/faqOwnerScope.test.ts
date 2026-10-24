// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 租户级 DB（§6.1 / §1.5，2026-10-25 补齐）：`faq_entries` 的**行级隔离**
 * （knowledge 五仓第 5 仓）。
 *
 * 该表此前落在共享本地库且无归属列 ⇒ 租户内两用户的 FAQ 条目互相可见/被去重误伤。
 * 本文件同时锁四件事：
 *   ① 行为隔离：同租户 ALICE / BOB 的 FAQ 互不可见（list / search / getById / update / delete）；
 *   ② 去重归属：同 (question, answer) 内容 hash 跨用户互不误伤（BOB 建同内容不因 ALICE 的
 *      行被 KNOWLEDGE_FAQ_DUPLICATE 拒绝；id 为随机 UUID 非内容派生 ⇒ 单列 PK 互不覆盖）；
 *   ③ 删除只删自己：delete / deleteBatch 不波及他人（他人的等同不存在）；
 *   ④ 门禁：读写 SQL 全带 owner_key + 构造器不默认解析路径（惰性）+ 单例按租户分桶。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getFAQService,
  resetFAQServiceScopedForTest,
} from '../../src/knowledge/faq/FAQService';
import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';

const TENANT = `faq-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const ALICE: Principal = { tenantId: TENANT, userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: TENANT, userId: 'bob', roles: ['user'] };

const dataDir = mkdtempSync(join(tmpdir(), 'knowledge-faq-'));

const as = <T>(principal: Principal, fn: () => T): T =>
  runWithPrincipal(principal, fn);
const svc = () => getFAQService();

beforeAll(() => {
  process.env.LIRI_DATA_DIR = dataDir;
});

afterAll(() => {
  resetFAQServiceScopedForTest();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows：句柄释放滞后 ⇒ 交给系统临时目录清理
  }
});

describe('faq_entries：行级隔离', () => {
  it('同租户两用户的 FAQ 互不可见（list / search / getById / update）', async () => {
    const aliceEntry = await as(ALICE, () =>
      svc().create({
        knowledgeBaseName: 'kb1',
        question: 'alice 问题',
        answer: 'alice 答案',
      })
    );
    await as(BOB, () =>
      svc().create({
        knowledgeBaseName: 'kb1',
        question: 'bob 问题',
        answer: 'bob 答案',
      })
    );

    // list：只命中自己的
    expect(
      (await as(ALICE, () => svc().list({ knowledgeBaseName: 'kb1' }))).map(
        (e) => e.question
      )
    ).toEqual(['alice 问题']);
    expect(
      (await as(BOB, () => svc().list({ knowledgeBaseName: 'kb1' }))).map(
        (e) => e.question
      )
    ).toEqual(['bob 问题']);

    // search：只命中自己的
    expect(
      (await as(ALICE, () => svc().search({ query: 'alice' }))).map(
        (e) => e.question
      )
    ).toEqual(['alice 问题']);
    expect(await as(BOB, () => svc().search({ query: 'alice' }))).toEqual([]);

    // getById：他人条目等同不存在
    expect(await as(BOB, () => svc().getById(aliceEntry.id))).toBeNull();

    // update：他人条目等同不存在（不改动）
    expect(
      await as(BOB, () => svc().update(aliceEntry.id, { answer: 'hack' }))
    ).toBeNull();
    expect((await as(ALICE, () => svc().getById(aliceEntry.id)))?.answer).toBe(
      'alice 答案'
    );
  });

  it('同 (question, answer) 内容跨用户互不误伤（去重只看自己）', async () => {
    const shared = {
      knowledgeBaseName: 'kb2',
      question: '共同问题',
      answer: '共同答案',
    };
    await as(ALICE, () => svc().create(shared));
    // BOB 建同内容：不会被 ALICE 的行判定重复（KNOWLEDGE_FAQ_DUPLICATE）
    const bobEntry = await as(BOB, () => svc().create(shared));
    expect(bobEntry.question).toBe('共同问题');

    // 各在自己名下各 1 条（不互相覆盖、不互相判定重复）
    expect(
      (await as(ALICE, () => svc().list({ knowledgeBaseName: 'kb2' }))).filter(
        (e) => e.question === '共同问题'
      )
    ).toHaveLength(1);
    expect(
      (await as(BOB, () => svc().list({ knowledgeBaseName: 'kb2' }))).filter(
        (e) => e.question === '共同问题'
      )
    ).toHaveLength(1);
    expect(await as(BOB, () => svc().count('kb2'))).toBe(1);
    expect(await as(ALICE, () => svc().count('kb2'))).toBe(1);
  });

  it('delete / deleteBatch 只删自己的（他人的等同不存在）', async () => {
    const aliceEntry = await as(ALICE, () =>
      svc().create({
        knowledgeBaseName: 'kb3',
        question: 'alice 删除测试',
        answer: 'a',
      })
    );
    const bobEntry = await as(BOB, () =>
      svc().create({
        knowledgeBaseName: 'kb3',
        question: 'bob 删除测试',
        answer: 'b',
      })
    );

    // BOB 删 ALICE 的条目：0 行受影响，ALICE 的还在
    expect(await as(BOB, () => svc().delete(aliceEntry.id))).toBe(true);
    expect(
      (await as(ALICE, () => svc().getById(aliceEntry.id)))?.question
    ).toBe('alice 删除测试');

    // BOB 批量删 ALICE + 自己的：只删到自己的
    await as(BOB, () => svc().deleteBatch([aliceEntry.id, bobEntry.id]));
    expect(await as(BOB, () => svc().getById(bobEntry.id))).toBeNull();
    expect(
      (await as(ALICE, () => svc().getById(aliceEntry.id)))?.question
    ).toBe('alice 删除测试');
  });
});

describe('门禁：faq_entries 的读写 SQL 不许漏 owner_key；单例按租户分桶', () => {
  it('所有读写带 owner_key；表定义与单例都带归属结构', () => {
    const src = readFileSync(
      new URL('../../src/knowledge/faq/FAQService.ts', import.meta.url),
      'utf8'
    );

    // 字面量表名 + 以 SELECT/INSERT/UPDATE/DELETE 起头的模板语句
    const templates = [...src.matchAll(/`[^`]*\$\{FAQ_TABLE\}[^`]*`/g)].map(
      (m) => m[0]
    );
    const rowSql = templates.filter((sql) =>
      /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql)
    );

    // 现状 ≥6 条（create 判重 SELECT+INSERT / update SELECT+UPDATE / getById SELECT /
    // list SELECT / count SELECT / delete DELETE / deleteBatch DELETE / search SELECT /
    // getCategories SELECT）
    expect(rowSql.length).toBeGreaterThanOrEqual(6);

    for (const sql of rowSql) {
      expect(sql).toContain('owner_key');
    }

    // 表定义带归属列（新库 CREATE + 旧库 ALTER 补列）
    expect(src).toContain("owner_key TEXT NOT NULL DEFAULT 'local:local'");

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
    expect(src).toContain('isLocalPrincipal(principal)');
    expect(src).toContain('principalKeyOf(principal)');
    expect(src).toContain('registerScopedResource(principalKeyOf(principal)');
  });
});
