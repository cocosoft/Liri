// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software and to permit persons to whom the Software is
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
 * 租户级 DB 期 3：`SessionRouterStore` 的**行级隔离**（基础设施专项 §6.1）。
 *
 * 单表 `router_session_routes`：读写（get/set/delete）必须带 owner 过滤；
 * `cleanExpired()` 是跨用户维护动作（过期行对本租户所有用户都已失效）⇒ 显式豁免。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { SessionRouterStore } from '../../src/ai/router/SessionRouterStore';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';
import type { Principal } from '@openliri/kernel/identity/principal';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

const store = new SessionRouterStore(':memory:');

afterAll(() => {
  store.close();
});

describe('SessionRouterStore：行级隔离', () => {
  it('同一 sessionId 各存各的档位，读不到对方的', async () => {
    await runWithPrincipal(ALICE, () =>
      store.set('s-shared', 'simple', 'p-a', 'm-a')
    );
    await runWithPrincipal(BOB, () =>
      store.set('s-shared', 'reasoning', 'p-b', 'm-b')
    );

    const alice = await runWithPrincipal(ALICE, () => store.get('s-shared'));
    expect(alice?.tier).toBe('simple');
    expect(alice?.model).toBe('m-a');

    const bob = await runWithPrincipal(BOB, () => store.get('s-shared'));
    expect(bob?.tier).toBe('reasoning');
    expect(bob?.model).toBe('m-b');

    // 未写过该会话的第三个用户 ⇒ 空（不是别人的行）
    const carol: Principal = { tenantId: 'acme', userId: 'carol', roles: [] };
    expect(
      await runWithPrincipal(carol, () => store.get('s-shared'))
    ).toBeNull();
  });

  it('set 命中自己的行才累加 hit_count，不覆盖他人', async () => {
    await runWithPrincipal(ALICE, () =>
      store.set('s-shared', 'medium', 'p-a', 'm-a2')
    );
    const alice = await runWithPrincipal(ALICE, () => store.get('s-shared'));
    expect(alice?.hitCount).toBe(2);
    expect(alice?.tier).toBe('medium');

    const bob = await runWithPrincipal(BOB, () => store.get('s-shared'));
    expect(bob?.hitCount).toBe(1);
    expect(bob?.tier).toBe('reasoning');
  });
});

describe('门禁：SessionRouterStore 的读写 SQL 不许漏 owner_key', () => {
  it('除跨用户维护的 cleanExpired 外，每条读写 SQL 都必须带 owner_key', () => {
    const src = readFileSync(
      new URL('../../src/ai/router/SessionRouterStore.ts', import.meta.url),
      'utf8'
    );
    const templates = [
      ...src.matchAll(/`[^`]*\$\{SESSION_ROUTER_TABLE_NAME\}[^`]*`/g),
    ].map((m) => m[0]);
    const rowSql = templates.filter((sql) =>
      /\b(SELECT|INSERT|DELETE|UPDATE)\b/.test(sql)
    );

    // 现状 4 条（SELECT 1 / INSERT 1 / DELETE 2）；少于它说明扫描本身失效
    expect(rowSql.length).toBeGreaterThanOrEqual(4);

    const maintenance = rowSql.filter((sql) => sql.includes('updated_at < ?'));
    expect(maintenance).toHaveLength(1);

    for (const sql of rowSql.filter((s) => !s.includes('updated_at < ?'))) {
      expect(sql).toContain('owner_key');
    }

    // 复合主键：同一租户内不同用户可以有同名 sessionId
    expect(src).toContain('PRIMARY KEY (session_id, owner_key)');
    expect(src).toContain('ON CONFLICT(session_id, owner_key)');
  });
});
