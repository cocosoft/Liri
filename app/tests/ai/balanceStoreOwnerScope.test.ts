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
 * 租户级 DB 期 3：`BalanceStore` 的**行级隔离**（基础设施专项 §6.1）。
 *
 * 单表 `provider_balances`：主键改 `(provider_id, owner_key)`，4 条读写 SQL 全过滤。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { BalanceStore } from '../../src/ai/providers/BalanceStore';
import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

const store = BalanceStore.getInstance(':memory:');

beforeAll(async () => {
  await store.initialize();
});

afterAll(() => {
  store.close();
});

const balance = (remaining: number) => ({
  remaining,
  total: 100,
  used: 100 - remaining,
  isSupported: true,
  belowThreshold: false,
});

describe('BalanceStore：行级隔离', () => {
  it('同一 provider 各存各的余额', async () => {
    await runWithPrincipal(ALICE, () => store.setBalance('p-1', balance(10)));
    await runWithPrincipal(BOB, () => store.setBalance('p-1', balance(90)));

    expect(
      (await runWithPrincipal(ALICE, () => store.getBalance('p-1')))?.remaining
    ).toBe(10);
    expect(
      (await runWithPrincipal(BOB, () => store.getBalance('p-1')))?.remaining
    ).toBe(90);

    expect(
      await runWithPrincipal(ALICE, () => store.getAllBalances())
    ).toHaveLength(1);
  });

  it('删除不波及他人', async () => {
    await runWithPrincipal(BOB, () => store.deleteBalance('p-1'));
    expect(
      await runWithPrincipal(BOB, () => store.getBalance('p-1'))
    ).toBeUndefined();
    expect(
      (await runWithPrincipal(ALICE, () => store.getBalance('p-1')))?.remaining
    ).toBe(10);
  });
});

describe('门禁：BalanceStore 的读写 SQL 不许漏 owner_key', () => {
  it('所有 SELECT/INSERT/DELETE 模板都必须带 owner_key', () => {
    const src = readFileSync(
      new URL('../../src/ai/providers/BalanceStore.ts', import.meta.url),
      'utf8'
    );
    const templates = [
      ...src.matchAll(/`[^`]*\$\{BALANCES_TABLE\}[^`]*`/g),
    ].map((m) => m[0]);
    const rowSql = templates.filter((sql) =>
      /\b(SELECT|INSERT|UPDATE|DELETE)\b/.test(sql)
    );

    // 现状 4 条；少于它说明扫描本身失效
    expect(rowSql.length).toBeGreaterThanOrEqual(4);
    for (const sql of rowSql) expect(sql).toContain('owner_key');

    expect(src).toContain('PRIMARY KEY (provider_id, owner_key)');
  });
});
