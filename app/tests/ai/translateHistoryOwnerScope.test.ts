// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 租户级 DB（§6.1 / §1.5，2026-10-24 补齐）：`translate_history` 的**行级隔离**。
 *
 * 该表此前落在共享本地库且无归属列 ⇒ 租户内两用户互相可见/覆盖。本文件同时锁两件事：
 *   ① 行为隔离：同租户 ALICE / BOB 的记录互不可见、互不可改删（含 clearAll 只清自己）；
 *   ② SQL 漏过滤：所有读写模板必须带 `owner_key`，且动态 WHERE 必须以它起手。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TranslateHistoryStore } from '../../src/ai/translation/TranslateHistoryStore';
import { AppError } from '../../src/error/types';
import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';

const TENANT = `tr-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const ALICE: Principal = { tenantId: TENANT, userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: TENANT, userId: 'bob', roles: ['user'] };

const dataDir = mkdtempSync(join(tmpdir(), 'translate-history-'));

const as = <T>(principal: Principal, fn: () => T): T =>
  runWithPrincipal(principal, fn);
const store = () => TranslateHistoryStore.getInstance();

const record = (text: string) => ({
  groupId: 'g-1',
  sourceText: text,
  translatedText: `${text}-translated`,
  sourceLang: 'zh',
  targetLang: 'en',
  model: 'test-model',
  durationMs: 1,
  usageJson: null,
});

beforeAll(() => {
  process.env.LIRI_DATA_DIR = dataDir;
  TranslateHistoryStore.resetScopedForTest();
});

afterAll(() => {
  TranslateHistoryStore.resetScopedForTest();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows：句柄释放滞后 ⇒ 交给系统临时目录清理
  }
});

describe('translate_history：行级隔离', () => {
  it('同租户两用户的列表与计数各算各的', async () => {
    const aliceId = await as(ALICE, () => store().insert(record('alice-src')));
    await as(BOB, () => store().insert(record('bob-src')));

    const alicePage = await as(ALICE, () => store().query({}));
    const bobPage = await as(BOB, () => store().query({}));

    expect(alicePage.total).toBe(1);
    expect(alicePage.records[0].id).toBe(aliceId);
    expect(bobPage.total).toBe(1);
    expect(bobPage.records[0].sourceText).toBe('bob-src');
  });

  it('收藏 / 删除不波及他人（他人记录等同不存在）', async () => {
    const aliceId = (await as(ALICE, () => store().query({}))).records[0].id;

    await expect(as(BOB, () => store().toggleStar(aliceId))).rejects.toThrow(
      AppError
    );
    expect(await as(BOB, () => store().deleteById(aliceId))).toBe(false);
    expect(await as(BOB, () => store().deleteByIds([aliceId]))).toBe(0);
    // ALICE 自己仍可见且未被改动
    expect((await as(ALICE, () => store().query({}))).records[0].starred).toBe(
      false
    );

    expect(await as(ALICE, () => store().toggleStar(aliceId))).toBe(true);
    expect((await as(ALICE, () => store().query({}))).records[0].starred).toBe(
      true
    );
  });

  it('clearAll 只清当前用户（不是整表）', async () => {
    await as(ALICE, () => store().clearAll());
    expect((await as(ALICE, () => store().query({}))).total).toBe(0);
    expect((await as(BOB, () => store().query({}))).total).toBe(1);
  });
});

describe('门禁：translate_history 的读写 SQL 不许漏 owner_key', () => {
  it('所有读写模板带 owner_key；动态 WHERE 以 owner_key 起手', () => {
    const src = readFileSync(
      new URL(
        '../../src/ai/translation/TranslateHistoryStore.ts',
        import.meta.url
      ),
      'utf8'
    );

    // 字面量表名 + 以 SELECT/INSERT/UPDATE/DELETE 起头的模板语句
    const templates = [
      ...src.matchAll(/`[^`]*\$\{TRANSLATE_HISTORY_TABLE_NAME\}[^`]*`/g),
    ].map((m) => m[0]);
    const rowSql = templates.filter((sql) =>
      /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql)
    );

    // 现状 6 条（insert / count / select / toggle 的 select+update / deleteById / deleteByIds / clearAll）
    expect(rowSql.length).toBeGreaterThanOrEqual(6);

    for (const sql of rowSql.filter((s) => !s.includes('${whereClause}'))) {
      expect(sql).toContain('owner_key');
    }

    // 分页查询的动态 WHERE：归属过滤必须是**第一个**条件
    expect(src).toContain("const conditions: string[] = ['owner_key = ?']");
    expect(src).toContain('owner_key       TEXT NOT NULL DEFAULT');
  });
});

describe('门禁：TranslationService 不得在构造期钉死历史存储', () => {
  it('historyStore 用 getter 按调用身份解析（模块级单例构造发生在无身份时）', () => {
    const src = readFileSync(
      new URL(
        '../../src/ai/translation/TranslationService.ts',
        import.meta.url
      ),
      'utf8'
    );
    expect(src).toContain('private get historyStore(): TranslateHistoryStore');
    expect(src).not.toContain(
      'this.historyStore = TranslateHistoryStore.getInstance()'
    );
  });
});
