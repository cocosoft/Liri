// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 租户级 DB（§6.1 / §1.5，2026-10-25 补齐）：`kg_lineage` 的**行级隔离**
 * （knowledge 五仓第 3 仓）。
 *
 * 该表此前落在共享本地库且无归属列 ⇒ 租户内两用户的编译血缘互相可见/覆盖。
 * 本文件同时锁三件事：
 *   ① 行为隔离：同租户 ALICE / BOB 的血缘互不可见（query / findArtifactsByDoc /
 *      findDocsByArtifact 全链路）；
 *   ② SQL 漏过滤：所有读写 kg_lineage 的语句必须带 `owner_key`；
 *   ③ 单例分桶：租户实例按 tenantId 分桶 + 删租户释放 + 构造器不默认解析路径（惰性，
 *      init 时按当前请求身份解析 `resolveTenantDbPath()`）；
 *   ④ 同 (doc_path, artifact_type, artifact_id) 跨用户互不 IGNORE 覆盖
 *      （复合唯一约束含 owner_key）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getLineageStore,
  resetLineageStoreScopedForTest,
} from '../../src/knowledge/lineage/LineageStore';
import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';

const TENANT = `lineage-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const ALICE: Principal = { tenantId: TENANT, userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: TENANT, userId: 'bob', roles: ['user'] };

const dataDir = mkdtempSync(join(tmpdir(), 'knowledge-lineage-'));

const as = <T>(principal: Principal, fn: () => T): T =>
  runWithPrincipal(principal, fn);
const store = () => getLineageStore();

beforeAll(() => {
  process.env.LIRI_DATA_DIR = dataDir;
});

afterAll(() => {
  resetLineageStoreScopedForTest();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows：句柄释放滞后 ⇒ 交给系统临时目录清理
  }
});

describe('kg_lineage：行级隔离', () => {
  it('同租户两用户的血缘互不可见（query / findArtifactsByDoc / findDocsByArtifact）', async () => {
    await as(ALICE, () =>
      store().addLinks(
        'alice.md',
        [{ artifactType: 'page', artifactId: 'alice.html' }],
        1
      )
    );
    await as(BOB, () =>
      store().addLinks(
        'bob.md',
        [{ artifactType: 'page', artifactId: 'bob.html' }],
        1
      )
    );

    // query：只命中自己的
    expect(
      (await as(ALICE, () => store().query({ docPath: 'alice.md' }))).map(
        (l) => l.artifactId
      )
    ).toEqual(['alice.html']);
    expect(await as(BOB, () => store().query({ docPath: 'alice.md' }))).toEqual(
      []
    );
    expect(
      (await as(BOB, () => store().query({ docPath: 'bob.md' }))).map(
        (l) => l.artifactId
      )
    ).toEqual(['bob.html']);

    // findArtifactsByDoc：他人的 doc ⇒ 空
    expect(await as(BOB, () => store().findArtifactsByDoc('alice.md'))).toEqual(
      []
    );
    expect(
      (await as(ALICE, () => store().findArtifactsByDoc('alice.md'))).map(
        (l) => l.artifactId
      )
    ).toEqual(['alice.html']);

    // findDocsByArtifact：他人产物的反查 ⇒ 空
    expect(
      await as(BOB, () => store().findDocsByArtifact('page', 'alice.html'))
    ).toEqual([]);
    expect(
      (
        await as(ALICE, () => store().findDocsByArtifact('page', 'alice.html'))
      ).map((l) => l.docPath)
    ).toEqual(['alice.md']);
  });

  it('同一 (doc_path, artifact_type, artifact_id) 跨用户互不 IGNORE（复合唯一含 owner_key）', async () => {
    // 两用户编译相同产物 ⇒ 各占一行，不是互相 IGNORE
    const shared = 'shared.md';
    const addedAlice = await as(ALICE, () =>
      store().addLinks(
        shared,
        [{ artifactType: 'page', artifactId: 'shared.html' }],
        1
      )
    );
    const addedBob = await as(BOB, () =>
      store().addLinks(
        shared,
        [{ artifactType: 'page', artifactId: 'shared.html' }],
        1
      )
    );
    expect(addedAlice).toBe(1);
    expect(addedBob).toBe(1);

    // 互不见对方；自己那份完整存在（含 shared 与上一例的各自行）
    expect(
      (await as(ALICE, () => store().query({ docPath: shared }))).map(
        (l) => l.artifactId
      )
    ).toEqual(['shared.html']);
    expect(
      (await as(BOB, () => store().query({ docPath: shared }))).map(
        (l) => l.artifactId
      )
    ).toEqual(['shared.html']);
    expect(await as(ALICE, () => store().query())).toHaveLength(2);
    expect(await as(BOB, () => store().query())).toHaveLength(2);
  });

  it('purgeByDoc 只删自己的（他人的等同不存在）', async () => {
    // ALICE 删 alice.md（=1）；shared.md 是上一例 ALICE 自己写的（=1）；
    // BOB 的 bob.md + shared.md 全程不受波及
    expect(await as(ALICE, () => store().purgeByDoc('alice.md'))).toBe(1);
    expect(await as(ALICE, () => store().purgeByDoc('shared.md'))).toBe(1);
    expect(await as(ALICE, () => store().query())).toHaveLength(0);
    expect(await as(BOB, () => store().query())).toHaveLength(2);
    expect(
      (await as(BOB, () => store().query({ docPath: 'bob.md' }))).map(
        (l) => l.artifactId
      )
    ).toEqual(['bob.html']);
  });
});

describe('门禁：kg_lineage 的读写 SQL 不许漏 owner_key；单例按租户分桶', () => {
  it('所有读写带 owner_key；表定义与单例都带归属结构', () => {
    const src = readFileSync(
      new URL('../../src/knowledge/lineage/LineageStore.ts', import.meta.url),
      'utf8'
    );

    // 字面量表名 + 以 SELECT/INSERT/UPDATE/DELETE 起头的模板语句
    const templates = [
      ...src.matchAll(/`[^`]*\$\{KG_LINEAGE_TABLE\}[^`]*`/g),
    ].map((m) => m[0]);
    const rowSql = templates.filter((sql) =>
      /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql)
    );

    // 现状 ≥4 条（addLinks INSERT OR IGNORE / purgeByDoc SELECT+DELETE / query SELECT）
    expect(rowSql.length).toBeGreaterThanOrEqual(4);

    for (const sql of rowSql) {
      expect(sql).toContain('owner_key');
    }

    // 表定义带归属列（新库 CREATE + 旧库 ALTER 补列）+ 复合唯一约束
    expect(src).toContain("owner_key TEXT NOT NULL DEFAULT 'local:local'");
    expect(src).toContain(
      'UNIQUE(doc_path, artifact_type, artifact_id, owner_key)'
    );

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
