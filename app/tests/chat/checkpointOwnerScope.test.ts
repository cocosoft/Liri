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
 * 租户级 DB 期 3：`CheckpointDatabase` 的**行级隔离**（基础设施专项 §6.1）。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CheckpointDatabase } from '../../src/chat/services/CheckpointDatabase';
import type { SessionCheckpoint } from '../../src/session/types/checkpoint';
import { DataSessionStatus } from '../../src/session/types/session';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';
import type { Principal } from '@openliri/kernel/identity/principal';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

const db = new CheckpointDatabase(':memory:');

afterAll(async () => {
  await db.close();
});

const checkpoint = (
  over: Partial<SessionCheckpoint> & { id: string; sessionId: string }
): SessionCheckpoint => ({
  label: 'cp',
  createdAt: 1,
  messages: [],
  metadata: { title: 'cp' },
  state: DataSessionStatus.IDLE,
  tokenCount: 0,
  autoCreated: false,
  ...over,
});

describe('CheckpointDatabase：行级隔离', () => {
  it('保存后只有本人可见（loadCheckpoint / loadCheckpoints / latest / count）', async () => {
    await runWithPrincipal(ALICE, () =>
      db.saveCheckpoint(checkpoint({ id: 'cp-a', sessionId: 's-shared' }))
    );
    await runWithPrincipal(BOB, () =>
      db.saveCheckpoint(checkpoint({ id: 'cp-b', sessionId: 's-shared' }))
    );

    const aliceCp = await runWithPrincipal(ALICE, () =>
      db.loadCheckpoint('cp-a')
    );
    expect(aliceCp?.id).toBe('cp-a');

    // BOB 拿着 ALICE 的 id 也读不到
    expect(
      await runWithPrincipal(BOB, () => db.loadCheckpoint('cp-a'))
    ).toBeNull();

    const aliceList = await runWithPrincipal(ALICE, () =>
      db.loadCheckpoints('s-shared')
    );
    expect(aliceList.map((c) => c.id)).toEqual(['cp-a']);

    const bobLatest = await runWithPrincipal(BOB, () =>
      db.getLatestCheckpoint('s-shared')
    );
    expect(bobLatest?.id).toBe('cp-b');

    expect(
      await runWithPrincipal(ALICE, () => db.getCheckpointCount('s-shared'))
    ).toBe(1);
  });

  it('删除：不得波及别人的同名会话/同 id 检查点', async () => {
    await runWithPrincipal(ALICE, () =>
      db.deleteSessionCheckpoints('s-shared')
    );
    expect(
      await runWithPrincipal(BOB, () => db.getCheckpointCount('s-shared'))
    ).toBe(1);

    // 单条删除也按 owner 收口：BOB 删 ALICE 的 id 无效
    await runWithPrincipal(BOB, () => db.deleteCheckpoint('cp-b'));
    expect(
      await runWithPrincipal(BOB, () => db.loadCheckpoint('cp-b'))
    ).toBeNull();
  });
});

describe('门禁：CheckpointDatabase 的读写 SQL 不许漏 owner_key', () => {
  it('所有 SELECT/INSERT/DELETE/UPDATE 模板都必须带 owner_key', () => {
    const src = readFileSync(
      new URL('../../src/chat/services/CheckpointDatabase.ts', import.meta.url),
      'utf8'
    );
    const templates = [
      ...src.matchAll(/`[^`]*\$\{CHECKPOINT_TABLE\}[^`]*`/g),
    ].map((m) => m[0]);
    const rowSql = templates.filter((sql) =>
      /\b(SELECT|INSERT|DELETE|UPDATE)\b/.test(sql)
    );

    // 现状 8 条（INSERT 1 / SELECT 4 / DELETE 2 / …）；少于它说明扫描本身失效
    expect(rowSql.length).toBeGreaterThanOrEqual(7);
    for (const sql of rowSql) expect(sql).toContain('owner_key');
  });
});
