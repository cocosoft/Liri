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
 * 租户级 DB 期 3：`DBTAORCheckpointStorage` 的**行级隔离**（基础设施专项 §6.1）。
 *
 * 单表 `taor_checkpoints`：主键 `(id, owner_key)`；读写均过滤；`cleanup` 是跨用户维护动作。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { DBTAORCheckpointStorage } from '../../src/query/DBTAORCheckpointStorage';
import { TAORPhase, type TAORCheckpoint } from '../../src/query/types';
import { TokenBudgetStatus } from '../../src/tokenBudget/TokenBudgetController';
import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

const storage = new DBTAORCheckpointStorage(':memory:');

afterAll(async () => {
  await storage.close?.();
});

const checkpoint = (id: string): TAORCheckpoint => ({
  id,
  sessionId: 's-shared',
  turnCount: 1,
  phase: TAORPhase.THINK,
  budgetState: {
    status: TokenBudgetStatus.NORMAL,
    currentTokens: 0,
    maxTokens: 1000,
    maxOutputTokens: 100,
    percentUsed: 0,
    isWarning: false,
    isCritical: false,
    remainingTokens: 1000,
    remainingOutputTokens: 100,
    resetAt: 0,
    totalTokensUsed: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    totalOutputTokensUsed: 0,
    messagesProcessed: 0,
    shouldCompact: false,
    modelName: 'm',
  },
  conversationSummary: '',
  lastPrompt: '',
  createdAt: 1,
  type: 'auto',
});

describe('DBTAORCheckpointStorage：行级隔离', () => {
  it('保存后只有本人可见（load / findBySessionId / getPendingSessions）', async () => {
    await runWithPrincipal(ALICE, () => storage.save(checkpoint('cp-a')));
    await runWithPrincipal(BOB, () => storage.save(checkpoint('cp-b')));

    expect(
      (await runWithPrincipal(ALICE, () => storage.load('cp-a')))?.id
    ).toBe('cp-a');
    expect(await runWithPrincipal(BOB, () => storage.load('cp-a'))).toBeNull();

    expect(
      (
        await runWithPrincipal(ALICE, () => storage.findBySessionId('s-shared'))
      )?.map((c) => c.id)
    ).toEqual(['cp-a']);
    expect(
      (
        await runWithPrincipal(BOB, () => storage.findBySessionId('s-shared'))
      )?.map((c) => c.id)
    ).toEqual(['cp-b']);

    expect(
      await runWithPrincipal(ALICE, () => storage.getPendingSessions())
    ).toEqual(['s-shared']);
  });

  it('删除不波及他人', async () => {
    await runWithPrincipal(BOB, () => storage.delete('cp-a'));
    expect(
      (await runWithPrincipal(ALICE, () => storage.load('cp-a')))?.id
    ).toBe('cp-a');

    await runWithPrincipal(BOB, () => storage.deleteSession('s-shared'));
    expect(
      (await runWithPrincipal(ALICE, () => storage.findBySessionId('s-shared')))
        ?.length
    ).toBe(1);
    expect(
      await runWithPrincipal(BOB, () => storage.findBySessionId('s-shared'))
    ).toBeNull();
  });

  it('cleanup 是跨用户维护动作（过期行对所有人无价值）', async () => {
    // 上一条用例把 BOB 的行删了 ⇒ 补一条，确保两位用户都有过期行
    await runWithPrincipal(BOB, () => storage.save(checkpoint('cp-b2')));

    // 未来过期点 ⇒ 两位用户的行都应被清掉
    const removed = await runWithPrincipal(ALICE, () =>
      storage.cleanup(Date.now() + 60_000)
    );
    expect(removed).toBe(2);
    expect(
      await runWithPrincipal(ALICE, () => storage.findBySessionId('s-shared'))
    ).toBeNull();
  });
});

describe('门禁：DBTAORCheckpointStorage 的读写 SQL 不许漏 owner_key', () => {
  it('除 cleanup 的跨用户清理外，每条读写 SQL 都必须带 owner_key', () => {
    const src = readFileSync(
      new URL('../../src/query/DBTAORCheckpointStorage.ts', import.meta.url),
      'utf8'
    );
    const templates = [
      ...src.matchAll(/`[^`]*\$\{TAOR_CHECKPOINTS_TABLE_NAME\}[^`]*`/g),
    ].map((m) => m[0]);
    const rowSql = templates.filter((sql) =>
      /\b(SELECT|INSERT|UPDATE|DELETE)\b/.test(sql)
    );

    // 现状 9 条；少于它说明扫描本身失效
    expect(rowSql.length).toBeGreaterThanOrEqual(9);

    const maintenance = rowSql.filter((sql) => sql.includes('created_at < ?'));
    expect(maintenance).toHaveLength(2);
    for (const sql of rowSql.filter((s) => !s.includes('created_at < ?'))) {
      expect(sql).toContain('owner_key');
    }

    expect(src).toContain('PRIMARY KEY (id, owner_key)');
  });
});
