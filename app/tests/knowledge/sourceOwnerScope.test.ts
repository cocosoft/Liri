// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 租户级 DB（§6.1 / §1.5，2026-10-25 补齐）：`knowledge_source_chunks` 的**行级隔离**
 * （knowledge 五仓第 4 仓）。
 *
 * 该表此前落在共享本地库且无归属列 ⇒ 租户内两用户的原文块互相可见/覆盖。
 * 本文件同时锁三件事：
 *   ① 行为隔离：同租户 ALICE / BOB 的原文块互不可见（search / deleteByRaw）；
 *   ② SQL 漏过滤：所有读写 knowledge_source_chunks 的语句必须带 `owner_key`；
 *   ③ 单例分桶：租户实例按 tenantId 分桶 + 删租户释放 + 构造器不默认解析路径（惰性，
 *      init 时按当前请求身份解析 `resolveTenantDbPath()`）；
 *   ④ 同 rawPath 同 seq（内容派生 id）跨用户互不覆盖（复合 PK 含 owner_key）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getSourceChunkStore,
  resetSourceChunkStoreScopedForTest,
} from '../../src/knowledge/source/SourceChunkStore';
import type { SourceChunk } from '../../src/knowledge/source/sourceChunker';
import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';

const TENANT = `source-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const ALICE: Principal = { tenantId: TENANT, userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: TENANT, userId: 'bob', roles: ['user'] };

const dataDir = mkdtempSync(join(tmpdir(), 'knowledge-source-'));

const as = <T>(principal: Principal, fn: () => T): T =>
  runWithPrincipal(principal, fn);
const store = () => getSourceChunkStore();

const chunk = (rawPath: string, seq: number, text: string): SourceChunk => ({
  rawPath,
  seq,
  text,
});

beforeAll(() => {
  process.env.LIRI_DATA_DIR = dataDir;
});

afterAll(() => {
  resetSourceChunkStoreScopedForTest();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows：句柄释放滞后 ⇒ 交给系统临时目录清理
  }
});

describe('knowledge_source_chunks：行级隔离', () => {
  it('同租户两用户的原文块互不可见（search / deleteByRaw）', async () => {
    await as(ALICE, () =>
      store().replaceForRaw('alice.pdf', [
        chunk('alice.pdf', 1, 'alice 文本 alpha'),
      ])
    );
    await as(BOB, () =>
      store().replaceForRaw('bob.pdf', [chunk('bob.pdf', 1, 'bob 文本 beta')])
    );

    // search：只命中自己的
    expect(
      (await as(ALICE, () => store().search('alice 文本'))).map(
        (c) => c.rawPath
      )
    ).toEqual(['alice.pdf']);
    expect(await as(BOB, () => store().search('alice 文本'))).toEqual([]);
    expect(
      (await as(BOB, () => store().search('bob 文本'))).map((c) => c.rawPath)
    ).toEqual(['bob.pdf']);
  });

  it('同 rawPath 同 seq（内容派生 id）跨用户互不覆盖（复合 PK 含 owner_key）', async () => {
    const shared = 'shared.pdf';
    // ALICE 先写 2 块；BOB 同 raw 写 1 块 ⇒ 各占一行，不是互相覆盖
    await as(ALICE, () =>
      store().replaceForRaw(shared, [
        chunk(shared, 1, 'shared 第一段'),
        chunk(shared, 2, 'shared 第二段'),
      ])
    );
    await as(BOB, () =>
      store().replaceForRaw(shared, [chunk(shared, 1, 'shared 一段（BOB）')])
    );

    // ALICE 自己的 2 块完整（未被 BOB 的 DELETE+INSERT 清掉/覆盖）
    expect(await as(ALICE, () => store().search('shared'))).toHaveLength(2);
    expect(
      (await as(ALICE, () => store().search('shared'))).map((c) => c.seq)
    ).toEqual([1, 2]);
    // BOB 只有自己的 1 块
    expect(await as(BOB, () => store().search('shared'))).toHaveLength(1);
    expect(
      (await as(BOB, () => store().search('shared'))).map((c) => c.text)
    ).toEqual(['shared 一段（BOB）']);
  });

  it('deleteByRaw 只删自己的（他人的等同不存在）', async () => {
    // BOB 删 shared.pdf（=1）；ALICE 的 alice.pdf + shared.pdf 全程不受波及
    expect(await as(BOB, () => store().deleteByRaw('shared.pdf'))).toBe(1);
    expect(await as(ALICE, () => store().search('alice 文本'))).toHaveLength(1);
    expect(await as(ALICE, () => store().search('shared'))).toHaveLength(2);
    expect(await as(BOB, () => store().search('shared'))).toHaveLength(0);
  });
});

describe('门禁：knowledge_source_chunks 的读写 SQL 不许漏 owner_key；单例按租户分桶', () => {
  it('所有读写带 owner_key；表定义与单例都带归属结构', () => {
    const src = readFileSync(
      new URL(
        '../../src/knowledge/source/SourceChunkStore.ts',
        import.meta.url
      ),
      'utf8'
    );

    // 字面量表名 + 以 SELECT/INSERT/UPDATE/DELETE 起头的模板语句
    const templates = [
      ...src.matchAll(/`[^`]*\$\{SOURCE_CHUNKS_TABLE\}[^`]*`/g),
    ].map((m) => m[0]);
    const rowSql = templates.filter((sql) =>
      /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql)
    );

    // 现状 ≥3 条（replaceForRaw DELETE+INSERT / deleteByRaw SELECT+DELETE / search SELECT）
    expect(rowSql.length).toBeGreaterThanOrEqual(3);

    for (const sql of rowSql) {
      expect(sql).toContain('owner_key');
    }

    // 表定义带归属列（新库 CREATE + 旧库 ALTER 补列）+ 复合主键
    expect(src).toContain("owner_key TEXT NOT NULL DEFAULT 'local:local'");
    expect(src).toContain('PRIMARY KEY (id, owner_key)');

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
