/**
 * 多租户 P5：删除租户时丢弃**非 DB** 的按身份内存缓存
 *
 * 与 `tenantPurgeScopedDb.test.ts`（关数据库连接）互补：这里覆盖三类**不带连接**的
 * 按身份状态 —— 凭据实例（`CredentialStore`）、会话存储实例（`ScopedStorageRegistry`）、
 * 成本累计桶（`CostTracker`）。
 *
 * 为什么必须丢：
 *   - 凭据实例带 `credentials.json` 路径 ⇒ 留着会把文件**写回已删租户目录**；
 *   - 会话存储实例带基路径 + 内存索引 ⇒ 同上，且会把目录重建回来；
 *   - 成本桶是进程内累计 ⇒ 同名新租户会一上来继承旧用量。
 *
 * 说明：三者都是**进程级**缓存，其他用例文件可能留下同前缀条目 ⇒ 本文件用
 * **独有租户标识**（`cache-ten-*` / `cache-cost-*` / `cache-store-*` / `purge-cache`），
 * 只对本租户做绝对断言。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { setUserDataDirOverride } from '../../src/core/paths.js';
import { runWithPrincipal } from '../../src/core/identity/requestScope.js';
import type { Principal } from '../../src/core/identity/principal.js';
import { CredentialStore } from '../../src/ai/credentials/CredentialStore.js';
import {
  ScopedStorageRegistry,
  forgetScopedStoragesForTenant,
} from '../../src/session/gateway/ScopedStorageRegistry.js';
import type { UnifiedSessionStorage } from '../../src/session/storage/UnifiedStorage.js';
import { costTracker } from '../../src/cost/CostTracker.js';
import { purgeTenant } from '../../src/runtime/tenantPurge.js';

/** 构造一个非本地身份（本地身份不会进按身份缓存，测不到失效逻辑） */
function principalOf(tenantId: string, userId = 'alice'): Principal {
  return { tenantId, userId, roles: [] };
}

/** 注册表构造只要求"共享实例"，本文件走的是分区分支 ⇒ 桩对象足够 */
const SHARED_STUB = {} as UnifiedSessionStorage;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-purge-cache-'));
  setUserDataDirOverride(root);
});

afterEach(() => {
  setUserDataDirOverride(null);
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // @ignore-catch — Windows 句柄可能延迟释放，清理失败不影响断言
  }
});

describe('CredentialStore.forgetScopedForTenant', () => {
  it('只丢目标租户的实例（前缀隔离 + 幂等 + 丢弃后重取是新实例）', () => {
    const a = principalOf('cache-ten-a');
    const b = principalOf('cache-ten-b');
    const aBefore = runWithPrincipal(a, () => CredentialStore.getInstance());
    const bBefore = runWithPrincipal(b, () => CredentialStore.getInstance());

    expect(CredentialStore.forgetScopedForTenant('cache-ten-a')).toBe(1);
    // 幂等：已经摘过一次，再摘为 0
    expect(CredentialStore.forgetScopedForTenant('cache-ten-a')).toBe(0);
    // 隔离：另一租户的实例**没有**被连带摘除
    expect(CredentialStore.forgetScopedForTenant('cache-ten-b')).toBe(1);

    // 丢弃后重取是新实例（旧实例带着已删目录的路径，不能复用）
    expect(runWithPrincipal(a, () => CredentialStore.getInstance())).not.toBe(
      aBefore
    );
    expect(runWithPrincipal(b, () => CredentialStore.getInstance())).not.toBe(
      bBefore
    );

    // 清理：本文件独有前缀，避免把实例留给同进程的其他用例文件
    CredentialStore.forgetScopedForTenant('cache-ten-a');
    CredentialStore.forgetScopedForTenant('cache-ten-b');
  });
});

describe('costTracker.forgetBucketsForTenant', () => {
  it('只丢目标租户的累计桶', () => {
    const a = principalOf('cache-cost-a');
    const b = principalOf('cache-cost-b');
    // 触发分桶（首次访问即建桶）
    runWithPrincipal(a, () => costTracker.getTotalCostUSD());
    runWithPrincipal(b, () => costTracker.getTotalCostUSD());

    expect(costTracker.forgetBucketsForTenant('cache-cost-a')).toBe(1);
    expect(costTracker.forgetBucketsForTenant('cache-cost-a')).toBe(0);
    // 隔离：b 的桶仍在，所以能摘到 1
    expect(costTracker.forgetBucketsForTenant('cache-cost-b')).toBe(1);
  });
});

describe('forgetScopedStoragesForTenant', () => {
  it('关闭并摘除目标租户的会话存储实例，其他租户实例原样保留', async () => {
    const registry = new ScopedStorageRegistry(SHARED_STUB);
    const a = principalOf('cache-store-a');
    const b = principalOf('cache-store-b');
    const aBefore = await runWithPrincipal(a, () =>
      registry.forCurrentPrincipal()
    );
    const bBefore = await runWithPrincipal(b, () =>
      registry.forCurrentPrincipal()
    );

    expect(await forgetScopedStoragesForTenant('cache-store-a')).toBe(1);

    // 丢弃后重取是新实例：旧实例的内存索引已清空、路径指向刚被删的目录
    const aAfter = await runWithPrincipal(a, () =>
      registry.forCurrentPrincipal()
    );
    expect(aAfter).not.toBe(aBefore);
    // 隔离：另一租户拿到的仍是原实例
    expect(
      await runWithPrincipal(b, () => registry.forCurrentPrincipal())
    ).toBe(bBefore);

    expect(await forgetScopedStoragesForTenant('cache-store-b')).toBe(1);
    await aAfter.close();
  });
});

describe('purgeTenant：非 DB 缓存失效接线', () => {
  it('removed.scopedCaches 反映三类缓存的实际丢弃数，且分区目录被删', async () => {
    const tenantId = 'purge-cache';
    const principal = principalOf(tenantId);
    const registry = new ScopedStorageRegistry(SHARED_STUB);

    runWithPrincipal(principal, () => CredentialStore.getInstance());
    runWithPrincipal(principal, () => costTracker.getTotalCostUSD());
    const store = await runWithPrincipal(principal, () =>
      registry.forCurrentPrincipal()
    );
    // 分区目录此时确实存在（存储实例 initialize 时建的）
    expect(existsSync(join(root, 'data', 'tenants', tenantId))).toBe(true);
    expect(store).not.toBe(SHARED_STUB);

    const report = await purgeTenant(tenantId);

    expect(report.removed.scopedCaches).toBe(3);
    expect(report.removed.tenantDataDir).toBe(true);
    expect(existsSync(join(root, 'data', 'tenants', tenantId))).toBe(false);
  });
});
