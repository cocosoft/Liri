// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 租户级 DB 期 3：`ProviderManager` 的**行级隔离**（基础设施专项 §6.1）。
 *
 * 单表 `ai_providers`：主键改 `(id, owner_key)`；列表 / 单查 / 更新 / 统计全过滤。
 * 不覆盖 `deleteProvider`（它会级联操作模型与任务分工，属另一条链路），其 SQL 由门禁锁。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { ProviderManager } from '../../src/ai/providers/ProviderManager';
import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';

// 2026-10-24（CI ubuntu 红）：`ProviderManager.getInstance(':memory:')` 在模块求值时**无身份**
// ⇒ 命中进程级单例，可能与**同进程其它测试文件**共用同一实例/库。固定租户 `acme` 会因此读到
// 上一份残留行（实测：Alice 列表多出 `alice-renamed`、统计 count 1→2）。租户按进程取唯一值 ⇒
// 本文件的行永远只属于自己，跨文件/重复执行互不干扰；断言语义（行级隔离）不变。
const TENANT = `acme-pm-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const ALICE: Principal = { tenantId: TENANT, userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: TENANT, userId: 'bob', roles: ['user'] };

const manager = ProviderManager.getInstance(':memory:');

beforeAll(async () => {
  await manager.initialize();
});

afterAll(() => {
  manager.close();
});

const provider = (name: string) => ({
  name,
  providerType: 'openai' as const,
  baseUrl: 'https://example.invalid/v1',
});

describe('ProviderManager：行级隔离', () => {
  it('列表 / 单查只看得见自己的供应商', async () => {
    const aliceRec = await runWithPrincipal(ALICE, () =>
      manager.createProvider(provider('alice-p'))
    );
    const bobRec = await runWithPrincipal(BOB, () =>
      manager.createProvider(provider('bob-p'))
    );

    expect(
      (await runWithPrincipal(ALICE, () => manager.listProviders())).map(
        (p) => p.name
      )
    ).toEqual(['alice-p']);
    expect(
      (await runWithPrincipal(BOB, () => manager.listProviders())).map(
        (p) => p.name
      )
    ).toEqual(['bob-p']);

    expect(
      await runWithPrincipal(BOB, () => manager.getProvider(aliceRec.id))
    ).toBeUndefined();
    expect(
      (await runWithPrincipal(ALICE, () => manager.getProvider(aliceRec.id)))
        ?.name
    ).toBe('alice-p');
    expect(
      (await runWithPrincipal(BOB, () => manager.getProvider(bobRec.id)))?.name
    ).toBe('bob-p');
  });

  it('更新不波及他人（含乐观并发分支）', async () => {
    const [aliceRec] = await runWithPrincipal(ALICE, () =>
      manager.listProviders()
    );

    const hijack = await runWithPrincipal(BOB, () =>
      manager.updateProvider(aliceRec.id, { name: 'hijacked' })
    );
    expect(hijack).toBeUndefined();
    expect(
      (await runWithPrincipal(ALICE, () => manager.getProvider(aliceRec.id)))
        ?.name
    ).toBe('alice-p');

    // 自己的更新照常生效
    const updated = await runWithPrincipal(ALICE, () =>
      manager.updateProvider(aliceRec.id, { name: 'alice-renamed' })
    );
    expect(updated?.name).toBe('alice-renamed');
  });

  it('按类型统计各算各的', async () => {
    const aliceStats = await runWithPrincipal(ALICE, () =>
      manager.getProviderStats()
    );
    expect(aliceStats).toEqual([{ type: 'openai', count: 1, active: 1 }]);

    const bobStats = await runWithPrincipal(BOB, () =>
      manager.getProviderStats()
    );
    expect(bobStats).toEqual([{ type: 'openai', count: 1, active: 1 }]);
  });
});

describe('门禁：ProviderManager 的读写 SQL 不许漏 owner_key', () => {
  it('静态 SQL 全部带 owner_key；动态 WHERE 必须以 owner_key 收口', () => {
    const src = readFileSync(
      new URL('../../src/ai/providers/ProviderManager.ts', import.meta.url),
      'utf8'
    );
    const templates = [
      ...src.matchAll(/`[^`]*\$\{PROVIDERS_TABLE\}[^`]*`/g),
    ].map((m) => m[0]);
    const rowSql = templates.filter((sql) =>
      /\b(SELECT|INSERT|UPDATE|DELETE)\b/.test(sql)
    );

    // 现状 7 条（list / get / insert / update / delete / stats / 迁移 SELECT + 迁移 UPDATE）
    expect(rowSql.length).toBeGreaterThanOrEqual(7);

    for (const sql of rowSql.filter((s) => !s.includes('${whereClause}'))) {
      expect(sql).toContain('owner_key');
    }

    // 动态 WHERE 分支（updateProvider 的乐观并发）：归属过滤必须写在 whereClause 里
    expect(rowSql.filter((s) => s.includes('${whereClause}'))).toHaveLength(1);
    expect(src).toContain("let whereClause = 'WHERE id = ? AND owner_key = ?'");

    expect(src).toContain('PRIMARY KEY (id, owner_key)');
  });
});
