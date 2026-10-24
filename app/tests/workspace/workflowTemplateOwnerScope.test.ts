// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 租户级 DB（§6.1 / §1.5，2026-10-25 补齐）：`workflow_templates` 的**行级隔离**。
 *
 * 该表此前落在共享本地库且无归属列 ⇒ 租户内两用户的模板互相可见/覆盖。
 * 本文件同时锁三件事：
 *   ① 行为隔离：同租户 ALICE / BOB 的模板互不可见、不可改删（`listSync` 快照也不串读）；
 *   ② SQL 漏过滤：所有读写模板必须带 `owner_key`；
 *   ③ 单例分桶：租户实例按 tenantId 分桶 + 删租户释放 + 显式路径不混默认单例。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getWorkflowTemplateStore,
  resetWorkflowTemplateStoreScopedForTest,
} from '../../src/workspace/WorkflowTemplateStore';
import type { WorkflowTemplate } from '../../src/workspace/types';
import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';

const TENANT = `wt-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const ALICE: Principal = { tenantId: TENANT, userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: TENANT, userId: 'bob', roles: ['user'] };

const dataDir = mkdtempSync(join(tmpdir(), 'workflow-templates-'));

const as = <T>(principal: Principal, fn: () => T): T =>
  runWithPrincipal(principal, fn);
const store = () => getWorkflowTemplateStore();

const tpl = (id: string): WorkflowTemplate => ({
  id,
  name: id,
  description: '',
  category: 'custom',
  steps: [],
  author: 'user',
  isPublic: false,
  usageCount: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  tags: [],
});

beforeAll(() => {
  process.env.LIRI_DATA_DIR = dataDir;
});

afterAll(() => {
  resetWorkflowTemplateStoreScopedForTest();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows：句柄释放滞后 ⇒ 交给系统临时目录清理
  }
});

describe('workflow_templates：行级隔离', () => {
  it('同租户两用户的模板互不可见（list / get）', async () => {
    await as(ALICE, () => store().upsert(tpl('a-tpl')));
    await as(BOB, () => store().upsert(tpl('b-tpl')));

    const aliceList = await as(ALICE, () => store().list());
    const bobList = await as(BOB, () => store().list());
    expect(aliceList.map((t) => t.id)).toEqual(['a-tpl']);
    expect(bobList.map((t) => t.id)).toEqual(['b-tpl']);

    // 跨用户 get ⇒ null（他人的模板等同不存在）
    expect(await as(ALICE, () => store().get('b-tpl'))).toBeNull();
    expect(await as(BOB, () => store().get('a-tpl'))).toBeNull();
  });

  it('listSync 同步快照按 owner 分桶，不串读他人', async () => {
    // 预热：ALICE 先 list（写 ALICE 桶），BOB 后 list（写 BOB 桶）
    await as(ALICE, () => store().list());
    await as(BOB, () => store().list());

    // ALICE 的 listSync 只能看到自己的（不受 BOB 交替 list 污染）
    expect(
      as(ALICE, () =>
        store()
          .listSync()
          .map((t) => t.id)
      )
    ).toEqual(['a-tpl']);
    expect(
      as(BOB, () =>
        store()
          .listSync()
          .map((t) => t.id)
      )
    ).toEqual(['b-tpl']);

    // upsert / remove 只维护当前身份的桶
    await as(BOB, () => store().upsert(tpl('b-tpl2')));
    expect(
      as(BOB, () =>
        store()
          .listSync()
          .map((t) => t.id)
          .sort()
      )
    ).toEqual(['b-tpl', 'b-tpl2']);
    expect(
      as(ALICE, () =>
        store()
          .listSync()
          .map((t) => t.id)
      )
    ).toEqual(['a-tpl']);
  });

  it('remove 不波及他人（他人的模板等同不存在）', async () => {
    expect(await as(BOB, () => store().remove('a-tpl'))).toBe(false);
    expect(await as(ALICE, () => store().get('a-tpl'))).not.toBeNull();
    expect(await as(ALICE, () => store().remove('a-tpl'))).toBe(true);
  });
});

describe('门禁：workflow_templates 的读写 SQL 不许漏 owner_key；快照按 owner 分桶', () => {
  it('所有读写模板带 owner_key；表定义与单例都带归属结构', () => {
    const src = readFileSync(
      new URL('../../src/workspace/WorkflowTemplateStore.ts', import.meta.url),
      'utf8'
    );

    // 字面量表名 + 以 SELECT/INSERT/UPDATE/DELETE 起头的模板语句
    const templates = [
      ...src.matchAll(/`[^`]*\$\{WORKFLOW_TEMPLATES_TABLE\}[^`]*`/g),
    ].map((m) => m[0]);
    const rowSql = templates.filter((sql) =>
      /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql)
    );

    // 现状 4 条（queryAllForOwner SELECT / get SELECT / upsert INSERT / remove DELETE）
    expect(rowSql.length).toBeGreaterThanOrEqual(4);

    for (const sql of rowSql) {
      expect(sql).toContain('owner_key');
    }

    // 表定义带归属列（新库 CREATE + 旧库 ALTER 补列）
    expect(src).toContain("owner_key TEXT NOT NULL DEFAULT 'local:local'");

    // 快照按 owner 分桶（防同租户交替 list 串读）
    expect(src).toContain('snapshotByOwner');
    expect(src).toContain('snapshotByOwner.get(this.owner()) ?? []');

    // 单例按租户分桶 + 删租户时释放
    expect(src).toContain('scopedInstances');
    expect(src).toContain('resolveTenantDbPath(principal)');
    expect(src).toContain('registerScopedResource(principalKeyOf(principal)');
  });
});
