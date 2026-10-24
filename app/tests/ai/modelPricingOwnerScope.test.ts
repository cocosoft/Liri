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
 * 租户级 DB（§8-#14 选项 A）：`model_registry` 的**行级隔离**。
 *
 * 主键 `(model_id, owner_key)`；种子也按归属者各自播种 ⇒ 断言只比"同一 modelId 的
 * 取值互不串"，不断言总量（每家都有 YAML 种子）。
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  modelPricingService,
  ModelPricingService,
  resetModelPricingScopedForTest,
} from '../../src/ai/models/ModelPricingService';
import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

const dataDir = mkdtempSync(join(tmpdir(), 'model-registry-'));

beforeAll(() => {
  process.env.LIRI_DATA_DIR = dataDir;
  resetModelPricingScopedForTest();
});

beforeEach(() => {
  process.env.LIRI_DATA_DIR = dataDir;
});

afterAll(() => {
  resetModelPricingScopedForTest();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows：句柄释放滞后 ⇒ 交给系统临时目录清理
  }
});

const upsert = (displayName: string, input: number, output: number) =>
  modelPricingService.upsertPricing({
    modelId: 'm-shared',
    displayName,
    inputCostPerMillion: input,
    outputCostPerMillion: output,
  });

describe('model_registry：行级隔离', () => {
  it('同一 modelId 各存各的（展示名 / 价格互不覆盖）', async () => {
    await runWithPrincipal(ALICE, () => modelPricingService.initialize());
    await runWithPrincipal(BOB, () => modelPricingService.initialize());

    await runWithPrincipal(ALICE, () => upsert('alice-model', 1, 2));
    await runWithPrincipal(BOB, () => upsert('bob-model', 3, 4));

    const a = await runWithPrincipal(ALICE, () =>
      modelPricingService.getPricing('m-shared')
    );
    const b = await runWithPrincipal(BOB, () =>
      modelPricingService.getPricing('m-shared')
    );

    expect(a?.displayName).toBe('alice-model');
    expect(a?.inputCostPerMillion).toBe(1);
    expect(b?.displayName).toBe('bob-model');
    expect(b?.inputCostPerMillion).toBe(3);
    expect(a?.id).not.toBe(b?.id);
  });

  it('列表 / 计数只覆盖自己的行（各自都有 YAML 种子）', async () => {
    const aliceAll = await runWithPrincipal(ALICE, () =>
      modelPricingService.getAllPricing()
    );
    const bobAll = await runWithPrincipal(BOB, () =>
      modelPricingService.getAllPricing()
    );

    expect(aliceAll.filter((r) => r.modelId === 'm-shared')).toHaveLength(1);
    expect(bobAll.filter((r) => r.modelId === 'm-shared')).toHaveLength(1);

    const aliceCount = await runWithPrincipal(ALICE, () =>
      modelPricingService.getModelCount()
    );
    const bobCount = await runWithPrincipal(BOB, () =>
      modelPricingService.getModelCount()
    );
    expect(aliceCount).toBe(aliceAll.length);
    expect(bobCount).toBe(bobAll.length);
    expect(aliceCount).toBe(bobCount);
  });

  it('按 UUID 的读 / 改 / 删不波及他人', async () => {
    const mine = await runWithPrincipal(ALICE, () =>
      modelPricingService.getPricing('m-shared')
    );
    const id = mine!.id;

    expect(
      await runWithPrincipal(BOB, () => modelPricingService.getPricingById(id))
    ).toBeUndefined();
    expect(
      await runWithPrincipal(BOB, () => modelPricingService.toggleModelById(id))
    ).toBeNull();
    expect(
      await runWithPrincipal(BOB, () =>
        modelPricingService.setModelEnabledById(id, false)
      )
    ).toBeNull();
    expect(
      await runWithPrincipal(BOB, () => modelPricingService.deleteModelById(id))
    ).toBe(false);

    const still = await runWithPrincipal(ALICE, () =>
      modelPricingService.getPricingById(id)
    );
    expect(still?.modelId).toBe('m-shared');
  });

  it('同租户两用户共用实例（行级隔离而非实例级）', () => {
    const alice = runWithPrincipal(ALICE, () =>
      ModelPricingService.getInstance()
    );
    const bob = runWithPrincipal(BOB, () => ModelPricingService.getInstance());
    expect(bob).toBe(alice);
  });
});

describe('门禁：model_registry 的读写 SQL 不许漏 owner_key', () => {
  it('除遗留表迁移的计数外，每条读写 SQL 都必须带 owner_key', () => {
    const src = readFileSync(
      new URL('../../src/ai/models/ModelPricingService.ts', import.meta.url),
      'utf8'
    );
    const templates = [
      ...src.matchAll(/`[^`]*\$\{REGISTRY_TABLE\}[^`]*`/g),
    ].map((m) => m[0]);
    const rowSql = templates.filter((sql) =>
      /\b(SELECT|INSERT|UPDATE|DELETE)\b/.test(sql)
    );

    // 现状 21 条；少于它说明扫描本身失效
    expect(rowSql.length).toBeGreaterThanOrEqual(20);

    const withoutOwner = rowSql.filter((sql) => !sql.includes('owner_key'));
    // 仅「旧表迁移前是否已有数据」的计数（维护动作，覆盖全部归属）
    expect(withoutOwner).toHaveLength(1);
    expect(withoutOwner[0]).toContain('COUNT(*) as cnt');

    expect(src).toContain('PRIMARY KEY (model_id, owner_key)');
    expect(src).toContain('ON CONFLICT(model_id, owner_key)');
  });
});
