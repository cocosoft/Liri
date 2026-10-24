// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 门禁：按所有者分桶的内存缓存必须能被**删租户 / 退出登录**统一回收。
 *
 * 背景：`ModelRegistry` 的 `OwnerCache` 与 `ContextWindowResolver.modelWindows` 都按
 * `<tenant>:<user>` 分桶（租户库 §8-#14 A2）。分桶若没有回收路径，会随用户数无限增长；
 * 更关键的是**接线**：分桶必须登记在 `scopedResources`，才能被
 * `closeScopedResourcesForTenant()`（`tenantPurge` 的第 4 步）统一摘除。
 *
 * 本文件断言的是**接线本身**（不是 `clearModelWindowsForOwner` 的单元行为）：
 * 关闭租户后 → 模型分桶与窗口键同时消失，且随后读数会按 YAML 重新种子（无陈旧残留）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ModelRegistry } from '../../src/ai/models/ModelRegistry';
import { resetModelPricingScopedForTest } from '../../src/ai/models/ModelPricingService';
import {
  getModelWindow,
  setModelWindow,
} from '../../src/utils/ContextWindowResolver';
import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope';
import { closeScopedResourcesForTenant } from '@openliri/kernel/identity/scopedResources';

// 独立租户：避免与其它 owner-scope 用例共用登记项（关闭动作会摘除该租户的**全部**登记）
const TENANT = `reclaim-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const ALICE: Principal = { tenantId: TENANT, userId: 'alice', roles: ['user'] };

const dataDir = mkdtempSync(join(tmpdir(), 'owner-reclaim-'));

const as = <T>(fn: () => T): T => runWithPrincipal(ALICE, fn);
const registry = () => ModelRegistry.getInstance();

beforeAll(() => {
  process.env.LIRI_DATA_DIR = dataDir;
  ModelRegistry.resetCacheForTest();
  resetModelPricingScopedForTest();
});

afterAll(() => {
  ModelRegistry.resetCacheForTest();
  resetModelPricingScopedForTest();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows：句柄释放滞后 ⇒ 交给系统临时目录清理
  }
});

describe('owner 分桶的可回收性（tenantPurge 第 4 步）', () => {
  it('关闭租户后：模型分桶与窗口键同时消失，重读按 YAML 重新种子', async () => {
    as(() => registry().discoverModel('m-reclaim', { contextWindow: 4096 }));
    as(() => setModelWindow('w-reclaim', 8192));

    expect(as(() => registry().getModel('m-reclaim'))?.contextWindow).toBe(
      4096
    );
    expect(as(() => getModelWindow('w-reclaim'))).toBe(8192);

    const closed = await closeScopedResourcesForTenant(TENANT);
    expect(closed.failed).toEqual([]);
    expect(closed.closed).toBeGreaterThan(0);

    // 分桶已摘除：临时发现的模型不再可见（重读只按 YAML 种子重建）
    expect(as(() => registry().getModel('m-reclaim'))).toBeUndefined();
    // 窗口键同步释放（写入方 ModelRegistry 的同一 closer 负责）
    expect(as(() => getModelWindow('w-reclaim'))).toBeUndefined();
  });
});
