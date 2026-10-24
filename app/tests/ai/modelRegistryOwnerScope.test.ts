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
 * 租户级 DB（§8-#14 A2）：`ModelRegistry` 的**运行时缓存**按所有者分桶。
 *
 * 模型定义/定价/别名（`model_registry`）与供应商凭据（`providers`）都已按用户落行
 * （`owner_key`），进程级共享缓存会让同租户两用户的同名模型互相覆盖 ⇒ 断言"各存各的"。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ModelRegistry } from '../../src/ai/models/ModelRegistry';
import {
  modelPricingService,
  resetModelPricingScopedForTest,
} from '../../src/ai/models/ModelPricingService';
import {
  clearModelWindowsForOwner,
  getModelWindow,
  setModelWindow,
} from '../../src/utils/ContextWindowResolver';
import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

const dataDir = mkdtempSync(join(tmpdir(), 'model-registry-cache-'));

/** 在指定身份作用域内执行（同步/异步均继承该身份） */
function as<T>(principal: Principal, fn: () => T): T {
  return runWithPrincipal(principal, fn);
}

const registry = () => ModelRegistry.getInstance();

beforeAll(() => {
  process.env.LIRI_DATA_DIR = dataDir;
  resetModelPricingScopedForTest();
  ModelRegistry.resetCacheForTest();
});

afterAll(async () => {
  // 排空在途刷新（promise chain 串行化 ⇒ 等排在最后的一次即可）。
  // ⚠️ 必须在**已认证身份**里排空：本地身份下刷新会把 YAML 模型窗口写进 `local:local`
  // 分桶，污染同进程其它用例（如 `context/ContextWindowResolver` 的默认 200K 断言）。
  await as(ALICE, async () => {
    await registry().refreshDbPricing();
  }).catch(() => {
    // @ignore-catch: 测试收尾，刷新失败不影响断言结论
  });
  ModelRegistry.resetCacheForTest();
  resetModelPricingScopedForTest();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows：句柄释放滞后 ⇒ 交给系统临时目录清理
  }
});

describe('ModelRegistry：运行时缓存按所有者分桶', () => {
  it('同名 modelId 的两份定义各存各的（含 contextWindow）', () => {
    as(ALICE, () =>
      registry().discoverModel('m-shared', { contextWindow: 4096 })
    );
    as(BOB, () =>
      registry().discoverModel('m-shared', { contextWindow: 128000 })
    );

    expect(
      as(ALICE, () => registry().getModel('m-shared')?.contextWindow)
    ).toBe(4096);
    expect(as(BOB, () => registry().getModel('m-shared')?.contextWindow)).toBe(
      128000
    );
  });

  it('窗口缓存按所有者分桶（同租户两用户不互相覆盖）', () => {
    as(ALICE, () => setModelWindow('w-shared', 1000));
    expect(as(BOB, () => getModelWindow('w-shared'))).toBeUndefined();

    as(BOB, () => setModelWindow('w-shared', 2000));
    expect(as(ALICE, () => getModelWindow('w-shared'))).toBe(1000);
  });

  it('退出 / 删租户时清掉该所有者的窗口键（不留悬挂缓存）', () => {
    const aliceKey = `${ALICE.tenantId}:${ALICE.userId}`;
    as(ALICE, () => setModelWindow('w-cleanup', 4096));
    as(BOB, () => setModelWindow('w-cleanup', 8192));
    expect(as(ALICE, () => getModelWindow('w-cleanup'))).toBe(4096);

    // 按 owner 前缀清理：只摘 ALICE 的键，BOB 的同名键不受影响
    expect(clearModelWindowsForOwner(aliceKey)).toBeGreaterThan(0);
    expect(as(ALICE, () => getModelWindow('w-cleanup'))).toBeUndefined();
    expect(as(BOB, () => getModelWindow('w-cleanup'))).toBe(8192);
  });

  it('供应商凭据按所有者分桶（同一供应商类型不串号）', () => {
    as(ALICE, () =>
      registry().setProviderConfig('openai', { apiKey: 'key-alice' })
    );
    expect(
      as(BOB, () => registry().getProviderConfig('openai'))
    ).toBeUndefined();

    as(BOB, () =>
      registry().setProviderConfig('openai', { apiKey: 'key-bob' })
    );
    expect(
      as(ALICE, () => registry().getProviderConfig('openai')?.apiKey)
    ).toBe('key-alice');
    expect(as(BOB, () => registry().getProviderConfig('openai')?.apiKey)).toBe(
      'key-bob'
    );
  });

  it('定价与别名索引按所有者分桶（DB 装载只落当前用户）', async () => {
    await as(ALICE, async () => {
      await modelPricingService.initialize();
      await modelPricingService.upsertPricing({
        modelId: 'm-own',
        displayName: 'Alice 的模型',
        inputCostPerMillion: 3,
        outputCostPerMillion: 9,
        providerMappings: { firstParty: 'wire-own' },
      });
      await registry().refreshDbPricing();
    });

    expect(
      as(ALICE, () => registry().getModelPricing('m-own')?.inputPer1M)
    ).toBe(3);
    expect(as(ALICE, () => registry().resolveModelAlias('wire-own'))).toBe(
      'm-own'
    );

    // BOB 既读不到 ALICE 的定价，也解析不出 ALICE 的别名
    expect(as(BOB, () => registry().getModelPricing('m-own'))).toBeNull();
    expect(as(BOB, () => registry().resolveModelAlias('wire-own'))).toBe(
      'wire-own'
    );
  });
});
