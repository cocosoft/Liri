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
 * 租户级 DB 期 3：`SettlementOutbox` 的**行级隔离**（基础设施专项 §6.1）。
 *
 * 单表 `agent_settlement_outbox`：幂等键、认领、状态写、回放、巡检都必须带 owner；
 * `prune()` 与 init 期的重复行折叠是**跨用户维护动作**（显式豁免）。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { SettlementOutbox } from '../../src/chat/yield/SettlementOutbox';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';
import type { Principal } from '@openliri/kernel/identity/principal';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

const outbox = new SettlementOutbox(':memory:');
const ENDED_AT = 1_000;

afterAll(() => {
  outbox.close();
});

describe('SettlementOutbox：行级隔离', () => {
  it('同一 (sessionId, endedAt) 两用户各自入队，互不复用', async () => {
    const aliceId = await runWithPrincipal(ALICE, () =>
      outbox.enqueue({ sessionId: 's-shared', endedAt: ENDED_AT })
    );
    const bobId = await runWithPrincipal(BOB, () =>
      outbox.enqueue({ sessionId: 's-shared', endedAt: ENDED_AT })
    );

    expect(aliceId).toBeGreaterThan(0);
    expect(bobId).toBeGreaterThan(0);
    expect(aliceId).not.toBe(bobId);

    expect(
      (await runWithPrincipal(ALICE, () => outbox.listAll())).map((r) => r.id)
    ).toEqual([aliceId]);
    expect(
      (await runWithPrincipal(BOB, () => outbox.listAll())).map((r) => r.id)
    ).toEqual([bobId]);
  });

  it('同用户重复入队仍是幂等（复用未终结行）', async () => {
    const first = await runWithPrincipal(ALICE, () =>
      outbox.enqueue({ sessionId: 's-shared', endedAt: ENDED_AT })
    );
    const again = await runWithPrincipal(ALICE, () =>
      outbox.enqueue({ sessionId: 's-shared', endedAt: ENDED_AT })
    );
    expect(again).toBe(first);
    expect(await runWithPrincipal(ALICE, () => outbox.listAll())).toHaveLength(
      1
    );
  });

  it('别人的行：读不到、认领不到、改不了状态', async () => {
    const [aliceRow] = await runWithPrincipal(ALICE, () => outbox.listAll());

    expect(
      await runWithPrincipal(BOB, () => outbox.getRow(aliceRow.id))
    ).toBeNull();
    expect(
      await runWithPrincipal(BOB, () => outbox.claim(aliceRow.id))
    ).toBeNull();
    expect(
      await runWithPrincipal(BOB, () => outbox.markDelivered(aliceRow.id))
    ).toBe(false);

    // ALICE 自己那条仍是 pending（未被 BOB 的调用改动）
    expect(
      (await runWithPrincipal(ALICE, () => outbox.getRow(aliceRow.id)))?.state
    ).toBe('pending');

    // ALICE 自己认领成功
    const claimed = await runWithPrincipal(ALICE, () =>
      outbox.claim(aliceRow.id)
    );
    expect(claimed?.id).toBe(aliceRow.id);
    expect(claimed?.attempts).toBe(1);
  });

  it('回放候选与状态计数各算各的', async () => {
    const replayable = await runWithPrincipal(ALICE, () =>
      outbox.listReplayable()
    );
    expect(replayable).toHaveLength(1);
    expect(replayable[0]?.sessionId).toBe('s-shared');

    const bobCounts = await runWithPrincipal(BOB, () =>
      outbox.getStateCounts()
    );
    expect(bobCounts.pending).toBe(1);
    expect(bobCounts.attempting).toBe(0);

    const aliceCounts = await runWithPrincipal(ALICE, () =>
      outbox.getStateCounts()
    );
    expect(aliceCounts.attempting).toBe(1);
    expect(aliceCounts.pending).toBe(0);
  });
});

describe('门禁：SettlementOutbox 的读写 SQL 不许漏 owner_key', () => {
  it('除 prune 的跨用户裁剪外，每条读写 SQL 都必须带 owner_key', () => {
    const src = readFileSync(
      new URL('../../src/chat/yield/SettlementOutbox.ts', import.meta.url),
      'utf8'
    );
    const templates = [
      ...src.matchAll(/`[^`]*\$\{SETTLEMENT_OUTBOX_TABLE\}[^`]*`/g),
    ].map((m) => m[0]);
    const rowSql = templates.filter((sql) =>
      /\b(SELECT|INSERT|DELETE|UPDATE)\b/.test(sql)
    );

    // 现状 12 条；少于它说明扫描本身失效
    expect(rowSql.length).toBeGreaterThanOrEqual(12);

    const withoutOwner = rowSql.filter((sql) => !sql.includes('owner_key'));
    // 仅 `prune()` 的两条裁剪（跨用户维护：上限是本库总量约束）
    expect(withoutOwner).toHaveLength(2);
    for (const sql of withoutOwner) {
      expect(sql).toContain('DELETE FROM');
      expect(sql).not.toContain('session_id = ?');
    }

    // 幂等不变式必须按 owner 分组（否则同租户两用户同名会话互相顶掉）
    expect(src).toContain('(owner_key, session_id, ended_at)');
    expect(src).toContain('GROUP BY owner_key, session_id, ended_at');
  });
});
