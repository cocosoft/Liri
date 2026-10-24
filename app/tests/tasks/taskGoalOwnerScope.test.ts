// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 租户级 DB（§6.1 / §1.5，2026-10-25 补齐）：`task_goals` 的**行级隔离**。
 *
 * 该表此前落在共享本地库且无归属列 ⇒ 租户内两用户的目标互相可见/可改/可删。
 * 本文件同时锁两件事：
 *   ① 行为隔离：同租户 ALICE / BOB 的目标互不可见、互不可改删
 *     （含 `get` / `listBySession` / `listActive` 全库版 / `claimBudgetLimitWrapUp`）；
 *   ② SQL 漏过滤：所有读写模板必须带 `owner_key`。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getTaskGoalStore,
  resetTaskGoalStoreScopedForTest,
} from '../../src/tasks/goal/TaskGoalStore';
import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';

const TENANT = `tg-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const ALICE: Principal = { tenantId: TENANT, userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: TENANT, userId: 'bob', roles: ['user'] };

const dataDir = mkdtempSync(join(tmpdir(), 'task-goals-'));

const as = <T>(principal: Principal, fn: () => T): T =>
  runWithPrincipal(principal, fn);
const store = () => getTaskGoalStore();

beforeAll(() => {
  process.env.LIRI_DATA_DIR = dataDir;
});

afterAll(() => {
  resetTaskGoalStoreScopedForTest();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows：句柄释放滞后 ⇒ 交给系统临时目录清理
  }
});

describe('task_goals：行级隔离', () => {
  it('同租户两用户的目标互相不可见（get / listBySession / listActive 全库版）', async () => {
    const aliceGoal = await as(ALICE, () =>
      store().create({
        objective: 'alice-goal',
        sessionId: 's-alice',
        tokenBudget: 100,
      })
    );
    const bobGoal = await as(BOB, () =>
      store().create({
        objective: 'bob-goal',
        sessionId: 's-bob',
        tokenBudget: 100,
      })
    );

    // 跨用户 get ⇒ null（他人的目标等同不存在）
    expect(await as(ALICE, () => store().get(bobGoal.id))).toBeNull();
    expect(await as(BOB, () => store().get(aliceGoal.id))).toBeNull();

    // 按会话列：看不到他人的会话
    expect(await as(ALICE, () => store().listBySession('s-bob'))).toHaveLength(
      0
    );
    expect(await as(BOB, () => store().listBySession('s-alice'))).toHaveLength(
      0
    );
    expect(
      await as(ALICE, () => store().listBySession('s-alice'))
    ).toHaveLength(1);

    // listActive 全库版：只扫当前用户（长驻进程恢复视角 = 当前用户视角）
    const aliceActive = await as(ALICE, () => store().listActive());
    const bobActive = await as(BOB, () => store().listActive());
    expect(aliceActive.map((g) => g.id)).not.toContain(bobGoal.id);
    expect(bobActive.map((g) => g.id)).not.toContain(aliceGoal.id);
  });

  it('改 / 删不波及他人（他人的目标等同不存在）', async () => {
    const aliceId = (await as(ALICE, () => store().listActive()))[0].id;

    // BOB 对 ALICE 目标的各类写操作全部失效
    expect(
      await as(BOB, () => store().updateStatus(aliceId, 'completed'))
    ).toBe(false);
    expect(await as(BOB, () => store().setRunId(aliceId, 'run-bob'))).toBe(
      false
    );
    expect(
      await as(BOB, () =>
        store().updateFields(aliceId, { objective: 'hijack' })
      )
    ).toBeNull();
    expect(await as(BOB, () => store().addUsage(aliceId, 100))).toBeNull();
    expect(
      await as(BOB, () => store().bumpNoProgressStreak(aliceId))
    ).toBeNull();
    expect(
      await as(BOB, () => store().recordTurnStopReason(aliceId, 'turn_error'))
    ).toBe(false);
    expect(await as(BOB, () => store().remove(aliceId))).toBe(false);

    // ALICE 自己仍可见且未被改动
    const intact = await as(ALICE, () => store().get(aliceId));
    expect(intact).not.toBeNull();
    expect(intact?.objective).toBe('alice-goal');
    expect(intact?.status).toBe('active');
  });

  it('claimBudgetLimitWrapUp 按会话归属过滤（BOB 认领不到 ALICE 的）', async () => {
    const aliceId = (await as(ALICE, () => store().listBySession('s-alice')))[0]
      .id;

    // 触顶晋升（ALICE 身份下操作自己的目标）
    const promoted = await as(ALICE, () =>
      store().addUsageAndPromote(aliceId, 10_000)
    );
    expect(promoted?.promoted).toBe(true);

    // BOB 认领 ALICE 会话的收尾 ⇒ null
    expect(
      await as(BOB, () => store().claimBudgetLimitWrapUp('s-alice'))
    ).toBeNull();
    // ALICE 自己认领 ⇒ 命中
    expect(
      await as(ALICE, () => store().claimBudgetLimitWrapUp('s-alice'))
    ).not.toBeNull();
  });
});

describe('门禁：task_goals 的读写 SQL 不许漏 owner_key', () => {
  it('所有读写模板带 owner_key；表定义与单例都带归属结构', () => {
    const src = readFileSync(
      new URL('../../src/tasks/goal/TaskGoalStore.ts', import.meta.url),
      'utf8'
    );

    // 字面量表名 + 以 SELECT/INSERT/UPDATE/DELETE 起头的模板语句
    const templates = [
      ...src.matchAll(/`[^`]*\$\{TASK_GOALS_TABLE\}[^`]*`/g),
    ].map((m) => m[0]);
    const rowSql = templates.filter((sql) =>
      /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql)
    );

    // 现状 17 条（insert / get / listBySession / listActive×2 / markStatusChanged×2 /
    // setRunId / updateFields / addUsage / addUsageAndPromote×2 / claim 候选+认领 /
    // bumpNoProgressStreak / recordTurnStopReason / remove）
    expect(rowSql.length).toBeGreaterThanOrEqual(15);

    for (const sql of rowSql) {
      expect(sql).toContain('owner_key');
    }

    // 表定义带归属列（新库 CREATE + 旧库 ALTER 补列）
    expect(src).toContain("owner_key TEXT NOT NULL DEFAULT 'local:local'");

    // 单例按租户分桶 + 删租户时释放（防"接了等于没接"）
    expect(src).toContain('scopedInstances');
    expect(src).toContain('resolveTenantDbPath(principal)');
    expect(src).toContain('registerScopedResource(principalKeyOf(principal)');
  });
});
