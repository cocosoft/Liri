/**
 * 多租户 P5：成本事件按**归属身份**落库
 *
 * 背景：`COST_RECORDED` 订阅者只在启动时注册一次，启动期解析出的仓库永远是宿主库 ⇒
 * 所有租户的成本行都写进宿主 `app.db`（而读侧是按身份分库的，于是"租户库永远空、
 * 宿主库装所有人"）。修法是把 `ownerKey` 随事件带出，订阅者据此重建身份作用域。
 *
 * 本文件只验证**解析口径**（不同归属 ⇒ 不同实例；无归属 / 非法键 ⇒ 宿实例池），
 * 真实落库路径由 `getCostRecordRepository()` 的分身份实例保证（其自身的路径映射
 * 已有独立覆盖），此处不建库、不写盘，避免污染其他用例的数据根。
 */
import { describe, it, expect } from 'bun:test';

import { resolveCostRepositoryForEvent } from '../../src/cost/index.js';

// 用**本文件独有**的归属键：`getCostRecordRepository()` 的分身份实例是**进程级缓存**，
// 借用其他用例的 `acme:alice` 会把"按别的数据根建好的实例"留给那些用例。
const ALICE_KEY = 'cost-fixture-a:alice';
const BOB_KEY = 'cost-fixture-b:bob';

describe('resolveCostRepositoryForEvent：按事件归属分配成本库实例', () => {
  it('同一归属 ⇒ 同一实例（按身份缓存，不重复建库）', async () => {
    const first = await resolveCostRepositoryForEvent({ ownerKey: ALICE_KEY });
    const second = await resolveCostRepositoryForEvent({ ownerKey: ALICE_KEY });
    expect(second).toBe(first);
  });

  it('不同归属 ⇒ 不同实例（互不串库）', async () => {
    const alice = await resolveCostRepositoryForEvent({ ownerKey: ALICE_KEY });
    const bob = await resolveCostRepositoryForEvent({ ownerKey: BOB_KEY });
    expect(bob).not.toBe(alice);
  });

  it('无归属（本地 / 后台）⇒ 宿主实例，且与租户实例不同', async () => {
    const host = await resolveCostRepositoryForEvent({});
    const scoped = await resolveCostRepositoryForEvent({ ownerKey: ALICE_KEY });
    expect(host).not.toBe(scoped);
    // 再次取用仍是同一宿主实例（单例）
    expect(await resolveCostRepositoryForEvent({})).toBe(host);
  });

  it('非法归属键 ⇒ 回落宿主实例（不编造身份）', async () => {
    const host = await resolveCostRepositoryForEvent({});
    // 缺少 `:` 或任一侧为空 ⇒ `principalFromKey` 返回 null
    expect(await resolveCostRepositoryForEvent({ ownerKey: 'broken' })).toBe(
      host
    );
    expect(await resolveCostRepositoryForEvent({ ownerKey: ':bob' })).toBe(
      host
    );
    expect(await resolveCostRepositoryForEvent({ ownerKey: 'acme:' })).toBe(
      host
    );
  });
});
