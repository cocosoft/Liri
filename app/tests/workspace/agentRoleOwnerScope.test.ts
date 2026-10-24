// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 租户级 DB（§6.1 / §1.5，2026-10-25 补齐）：`agent_roles` 的**跨租户隔离**。
 *
 * 语义判定：`agent_roles` 是**租户级配置**（非用户级数据 —— 有默认播种、`agent_id` 全局
 * 唯一、双消费者同作用域共享）⇒ 隔离口径 = 库切租户 + 实例按 tenantId 分桶，
 * **不加 `owner_key`**（同租户内所有用户共享一套角色本就正确）。
 * 本文件锁两件事：
 *   ① 行为隔离：不同租户的角色配置**互相独立**（播种独立、修改互不可见）；
 *     同租户两用户共享同一份配置（租户级共享语义不破）。
 *   ② 结构门禁：单例按租户分桶 + 删租户释放 + 构造函数**不默认解析路径**（惰性）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getAgentRoleStore,
  resetAgentRoleStoreScopedForTest,
} from '../../src/workspace/AgentRoleStore';
import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';

const T_A = `ar-a-${process.pid}-${Math.random().toString(36).slice(2, 6)}`;
const T_B = `ar-b-${process.pid}-${Math.random().toString(36).slice(2, 6)}`;
const ALICE_A: Principal = { tenantId: T_A, userId: 'alice', roles: ['user'] };
const BOB_A: Principal = { tenantId: T_A, userId: 'bob', roles: ['user'] };
const CAROL_B: Principal = { tenantId: T_B, userId: 'carol', roles: ['user'] };

const dataDir = mkdtempSync(join(tmpdir(), 'agent-roles-'));

const as = <T>(principal: Principal, fn: () => T): T =>
  runWithPrincipal(principal, fn);
const store = () => getAgentRoleStore();

beforeAll(() => {
  process.env.LIRI_DATA_DIR = dataDir;
});

afterAll(() => {
  resetAgentRoleStoreScopedForTest();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows：句柄释放滞后 ⇒ 交给系统临时目录清理
  }
});

describe('agent_roles：跨租户隔离（租户级配置）', () => {
  it('不同租户各自播种默认角色，且修改互不可见', async () => {
    // 各自租户库独立播种 5 个默认角色
    const rolesA = await as(ALICE_A, async () => store().listAll());
    const rolesB = await as(CAROL_B, async () => store().listAll());
    expect(rolesA.map((r) => r.agentId)).toEqual([
      'architect',
      'security',
      'performance',
      'frontend',
      'backend',
    ]);
    expect(rolesB.map((r) => r.agentId)).toEqual(rolesA.map((r) => r.agentId));

    // A 租户改 architect 名 ⇒ B 租户不受影响
    const architectA = rolesA.find((r) => r.agentId === 'architect')!;
    await as(ALICE_A, () =>
      store().update(architectA.id!, { name: '架构师（A 租户定制）' })
    );
    expect(
      (await as(ALICE_A, () => store().getByAgentId('architect')))?.name
    ).toBe('架构师（A 租户定制）');
    expect(
      (await as(CAROL_B, () => store().getByAgentId('architect')))?.name
    ).toBe('架构师'); // B 仍是默认

    // A 新增角色 ⇒ B 看不到
    await as(ALICE_A, () =>
      store().insert({
        agentId: 'auditor',
        name: '审计员',
        expertise: ['合规'],
        weight: 1.0,
        systemPrompt: '审计角色',
        icon: '📋',
        sortOrder: 6,
        enabled: true,
      })
    );
    expect(
      await as(ALICE_A, () => store().getByAgentId('auditor'))
    ).not.toBeNull();
    expect(await as(CAROL_B, () => store().getByAgentId('auditor'))).toBeNull();
  });

  it('同租户两用户共享同一份配置（租户级共享语义不破）', async () => {
    // ALICE_A 已改过 architect；BOB_A 应看到同一份
    expect(
      (await as(BOB_A, () => store().getByAgentId('architect')))?.name
    ).toBe('架构师（A 租户定制）');
    // 删除也共享：BOB_A 删掉 auditor ⇒ ALICE_A 不可见
    const auditor = await as(BOB_A, () => store().getByAgentId('auditor'));
    await as(BOB_A, () => store().delete(auditor!.id!));
    expect(await as(ALICE_A, () => store().getByAgentId('auditor'))).toBeNull();
  });
});

describe('门禁：agent_roles 单例按租户分桶 + 惰性解析路径', () => {
  it('构造函数不默认解析路径；doInit 惰性解析；租户分桶 + 删租户释放', () => {
    const src = readFileSync(
      new URL('../../src/workspace/AgentRoleStore.ts', import.meta.url),
      'utf8'
    );

    // 构造不再用默认参数解析（防模块级单例在无身份下钉死共享库）
    expect(src).not.toContain('constructor(dbPath: string = resolveDbPath())');
    expect(src).toContain('constructor(dbPath?: string)');
    expect(src).toContain('const dbPath = this.dbPath ?? resolveDbPath();');

    // 单例按租户分桶 + 删租户时释放
    expect(src).toContain('scopedInstances');
    expect(src).toContain('resolveTenantDbPath(principal)');
    expect(src).toContain('registerScopedResource(principalKeyOf(principal)');

    // 租户级语义：**不得**出现 owner_key 列定义 / SQL 过滤（防误套用户级隔离破坏全局角色）
    expect(src).not.toContain('owner_key TEXT');
    expect(src).not.toContain('owner_key = ?');

    // 方法起手 await init()（防 fire-and-forget 播种竞态，根因修 CS05）
    expect(src).toContain('await this.init();');
  });
});
