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
 * 租户级 DB 期 3：`InboxManager`（审批库）的**行级隔离**（基础设施专项 §6.1）。
 *
 * 维护型语句（过期清理 / 去重索引检查 / 关联表清理）**有意不带 owner**：
 * 它们是跨用户动作，事件再按行内 `owner_key` 回落到各自身份（见 `_expireOnDb`）。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { InboxManager } from '../../src/runtime/InboxManager';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';
import type { Principal } from '@openliri/kernel/identity/principal';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

// 显式传路径 ⇒ 不按身份分库；但 owner 过滤仍按**当前身份**生效（正是要验的点）
const mgr = new InboxManager(':memory:');

afterAll(() => {
  mgr.dispose();
});

const submitAs = (who: Principal, title: string, sessionId = 's-shared') =>
  runWithPrincipal(who, () =>
    mgr.submit({
      sessionId,
      type: 'approval',
      title,
      message: 'm',
      source: 'test',
      offlineCapable: true,
      channelSessionId: 'cs-1',
    })
  );

describe('InboxManager：行级隔离', () => {
  it('提交后只有本人可见（list / get / pendingCount / bySession）', async () => {
    const a = await submitAs(ALICE, 'A 的审批');

    const aliceList = await runWithPrincipal(ALICE, () => mgr.list({}));
    expect(aliceList.items.map((i) => i.id)).toEqual([a.id]);
    expect(aliceList.total).toBe(1);

    // BOB 拿 id 也读不到
    expect(await runWithPrincipal(BOB, () => mgr.get(a.id))).toBeNull();
    expect(
      await runWithPrincipal(BOB, () => mgr.getPendingCount('s-shared'))
    ).toBe(0);

    const bobBySession = await runWithPrincipal(BOB, () =>
      mgr.getBySession('s-shared')
    );
    expect(bobBySession).toEqual([]);
  });

  it('回复 / 改状态 / 批量忽略：都不作用于别人的行', async () => {
    const a = await submitAs(ALICE, 'A 的审批 2');

    // BOB 尝试回复 ⇒ 返回 null（未命中），状态不变
    const bobReply = await runWithPrincipal(BOB, () =>
      mgr.reply(a.id, 'bob 的回复')
    );
    expect(bobReply).toBeNull();
    const stillPending = await runWithPrincipal(ALICE, () => mgr.get(a.id));
    expect(stillPending?.status).toBe('pending');

    // BOB 尝试 CAS 改状态 ⇒ false
    const bobCas = await runWithPrincipal(BOB, () =>
      mgr.tryUpdateStatus(a.id, 'pending', 'processing')
    );
    expect(bobCas).toBe(false);

    // BOB 的 dismissBySession 也不清 A 的
    await runWithPrincipal(BOB, () => mgr.dismissBySession('s-shared'));
    const afterDismiss = await runWithPrincipal(ALICE, () => mgr.get(a.id));
    expect(afterDismiss?.status).toBe('pending');
  });

  it('过期清理是跨用户维护动作（两侧都会被标 expired）', async () => {
    await submitAs(BOB, 'B 的审批', 's-bob');

    // maxAge 为负 ⇒ cutoff 在未来 ⇒ 所有 pending 都过期
    const expired = await mgr.expireAllScopes(-1000);
    expect(expired).toBeGreaterThanOrEqual(2);
  });
});

describe('门禁：InboxManager 的行级读写 SQL 不许漏 owner_key', () => {
  it('三张表的写入 + 按 id/session 定位的语句都必须带 owner_key', () => {
    const src = readFileSync(
      new URL('../../src/runtime/InboxManager.ts', import.meta.url),
      'utf8'
    );

    // 写入：三条 INSERT 的列清单必须含 owner_key
    expect(src).toMatch(/INSERT INTO inbox_items \([^)]*owner_key\)/);
    expect(src).toMatch(/INSERT INTO approval_audit_log \([^)]*owner_key\)/);
    expect(src).toMatch(
      /INSERT OR IGNORE INTO session_inbox_map \(session_id, inbox_item_id, created_at, owner_key\)/
    );

    // 定位：按 id 的 UPDATE/SELECT 必须同时带 owner_key（现状 5 处）
    const idWithOwner = src.match(/WHERE id = \? AND owner_key = \?/g) ?? [];
    expect(idWithOwner.length).toBeGreaterThanOrEqual(4);

    // 建表：三张表都要有 owner_key 列
    const ownerColumns =
      src.match(/owner_key TEXT NOT NULL DEFAULT 'local:local'/g) ?? [];
    expect(ownerColumns.length).toBeGreaterThanOrEqual(4);

    // 去重唯一索引必须把 owner_key 纳入键（否则同租户不同用户会互相顶掉）
    expect(src).toMatch(
      /ux_inbox_pending_approval[\s\S]*?owner_key,[\s\S]*?session_id/
    );
  });
});
