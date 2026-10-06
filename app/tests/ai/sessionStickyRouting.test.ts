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
 * 会话黏性路由**接线**回归（U7 / `任务计划-20261004.md` §21.4，2026-10-06）
 *
 * 背景：`SessionRouterStore` 曾被普查记为"零消费者死代码"，逐点复核后**改判**为
 * `SmartRouter` 的**可选注入能力**（层 3：同会话命中即**跳过 LLM Judge**）；
 * 用户裁定「接线」⇒ 本用例固化接线后的真实行为，防"接线了但没生效"或再次静默失联：
 *   ① 注入 store 且**黏性命中** ⇒ **不调用 Judge**，直接复用上次档位/模型；
 *   ② **未命中** ⇒ 走 Judge，且决策后**写回**黏性（层 6）；
 *   ③ `sessionSticky:false`（配置开关） ⇒ **不读**黏性（Judge 每轮照跑）；
 *   ④ `getSessionRouterStore()` 为**进程级单例**（重复调用同一实例）且能建表（真实 DB，隔离目录）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SmartRouter } from '../../src/ai/router/SmartRouter.js';
import type { RouterConfig } from '../../src/ai/router/types.js';
import { ProviderRegistry } from '../../src/ai/providers/ProviderRegistry.js';
import type { SessionRouterStore } from '../../src/ai/router/SessionRouterStore.js';
import {
  getSessionRouterStore,
  resetSessionRouterStoreForTest,
} from '../../src/ai/router/SessionRouterStore.js';

/** 四档均有模型（TierResolver 解析用；providerHint 仅作提示） */
function makeConfig(sessionSticky?: boolean): RouterConfig {
  return {
    enabled: true,
    defaultTier: 'medium',
    ...(sessionSticky === undefined ? {} : { sessionSticky }),
    tiers: {
      simple: { model: 'm-simple' },
      medium: { model: 'm-medium' },
      complex: { model: 'm-complex' },
      reasoning: { model: 'm-reasoning' },
    },
  };
}

/** 假黏性存储：只记录调用，不落盘（避免用例写真实 DB） */
function makeFakeStore(
  hit: {
    tier: string;
    provider: string;
    model: string;
  } | null
): { store: SessionRouterStore; calls: { get: number; set: number } } {
  const calls = { get: 0, set: 0 };
  const now = Date.now();
  const store = {
    get: async (): Promise<unknown> => {
      calls.get += 1;
      if (!hit) return null;
      return {
        sessionId: 's1',
        tier: hit.tier,
        provider: hit.provider,
        model: hit.model,
        createdAt: now,
        updatedAt: now,
        hitCount: 1,
      };
    },
    set: async (): Promise<void> => {
      calls.set += 1;
    },
  };
  return { store: store as unknown as SessionRouterStore, calls };
}

/** 让 fire-and-forget 的 `persistSession()` 有机会完成（层 6 不 await） */
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('会话黏性路由接线（U7/§21.4）', () => {
  it('① 黏性命中 ⇒ **跳过 Judge** 并复用上次档位/模型', async () => {
    let judgeCalls = 0;
    const { store, calls } = makeFakeStore({
      tier: 'simple',
      provider: 'p',
      model: 'm-sticky',
    });
    const router = new SmartRouter({
      config: makeConfig(true),
      providerRegistry: new ProviderRegistry(),
      classifyLocal: async () => {
        judgeCalls += 1;
        return 'reasoning';
      },
      sessionStore: store,
    });

    const decision = await router.decide('一个看起来很难的问题', 'sess-1');

    expect(calls.get).toBe(1);
    expect(judgeCalls).toBe(0); // ← 关键：命中即跳过 Judge（省一次模型调用）
    expect(decision.tier).toBe('simple');
    expect(decision.model).toBe('m-sticky');
  });

  it('② 黏性未命中 ⇒ 走 Judge，且决策后写回黏性（层 6）', async () => {
    let judgeCalls = 0;
    const { store, calls } = makeFakeStore(null);
    const router = new SmartRouter({
      config: makeConfig(true),
      providerRegistry: new ProviderRegistry(),
      classifyLocal: async () => {
        judgeCalls += 1;
        return 'complex';
      },
      sessionStore: store,
    });

    const decision = await router.decide('复杂任务', 'sess-2');
    await flushAsync(); // persistSession 为 fire-and-forget

    expect(calls.get).toBe(1);
    expect(judgeCalls).toBe(1);
    expect(decision.tier).toBe('complex');
    expect(decision.model).toBe('m-complex');
    expect(calls.set).toBe(1);
  });

  it('③ `sessionSticky:false` ⇒ **不读**黏性（Judge 每轮照跑）', async () => {
    let judgeCalls = 0;
    const { store, calls } = makeFakeStore({
      tier: 'simple',
      provider: 'p',
      model: 'm-sticky',
    });
    const router = new SmartRouter({
      config: makeConfig(false),
      providerRegistry: new ProviderRegistry(),
      classifyLocal: async () => {
        judgeCalls += 1;
        return 'reasoning';
      },
      sessionStore: store,
    });

    const decision = await router.decide('复杂任务', 'sess-3');
    await flushAsync();

    expect(calls.get).toBe(0); // 开关关闭 ⇒ 不查黏性
    expect(judgeCalls).toBe(1);
    expect(decision.tier).toBe('reasoning');
    // 开关只关"读"，层 6 仍会写（保证后续开启时可直接命中）
    expect(calls.set).toBe(1);
  });

  it('④ 上界保护：黏性档位偏低（simple）+ 当前消息更长 ⇒ **不复用**，交回 Judge', async () => {
    let judgeCalls = 0;
    const { store, calls } = makeFakeStore({
      tier: 'simple',
      provider: 'p',
      model: 'm-sticky',
    });
    const router = new SmartRouter({
      config: makeConfig(true),
      providerRegistry: new ProviderRegistry(),
      classifyLocal: async () => {
        judgeCalls += 1;
        return 'complex';
      },
      sessionStore: store,
    });

    // 长度 80 > DEFAULT_FAST_PATH_MAX_LENGTH(60) ⇒ 复杂度突增，禁止按 simple 复用
    const decision = await router.decide('长'.repeat(80), 'sess-4');

    expect(calls.get).toBe(1); // 查过黏性
    expect(judgeCalls).toBe(1); // 但被上界保护否决 ⇒ 真跑了 Judge
    expect(decision.tier).toBe('complex');
    expect(decision.model).toBe('m-complex');
  });

  it('⑤ 上界保护**反向不设限**：黏性档位 ≥ complex ⇒ 长消息仍复用', async () => {
    let judgeCalls = 0;
    const { store } = makeFakeStore({
      tier: 'reasoning',
      provider: 'p',
      model: 'm-sticky-high',
    });
    const router = new SmartRouter({
      config: makeConfig(true),
      providerRegistry: new ProviderRegistry(),
      classifyLocal: async () => {
        judgeCalls += 1;
        return 'simple';
      },
      sessionStore: store,
    });

    const decision = await router.decide('长'.repeat(80), 'sess-5');

    expect(judgeCalls).toBe(0); // over-provision 只多花成本、不降质量 ⇒ 无需保护
    expect(decision.tier).toBe('reasoning');
    expect(decision.model).toBe('m-sticky-high');
  });

  it('⑥ 边界：长度 == 阈值(60) ⇒ 复用；== 61 ⇒ 不复用', async () => {
    const makeRouter = (judgeTier: 'complex' = 'complex') => {
      let judgeCalls = 0;
      const { store } = makeFakeStore({
        tier: 'simple',
        provider: 'p',
        model: 'm-sticky',
      });
      const router = new SmartRouter({
        config: makeConfig(true),
        providerRegistry: new ProviderRegistry(),
        classifyLocal: async () => {
          judgeCalls += 1;
          return judgeTier;
        },
        sessionStore: store,
      });
      return { router, judgeCalls: () => judgeCalls };
    };

    const atThreshold = makeRouter();
    const d1 = await atThreshold.router.decide('x'.repeat(60), 'sess-6a');
    expect(atThreshold.judgeCalls()).toBe(0);
    expect(d1.model).toBe('m-sticky');

    const overThreshold = makeRouter();
    const d2 = await overThreshold.router.decide('x'.repeat(61), 'sess-6b');
    expect(overThreshold.judgeCalls()).toBe(1);
    expect(d2.model).toBe('m-complex');
  });
});

describe('getSessionRouterStore 进程级单例（接线唯一构造点）', () => {
  let dataDir: string;
  let prevDataDir: string | undefined;

  beforeAll(() => {
    // resolveDbPath() 每次调用读 env ⇒ 隔离到临时目录（不碰真实 ~/.pyapp/data/app.db）
    dataDir = mkdtempSync(join(tmpdir(), 'session-sticky-'));
    prevDataDir = process.env.LIRI_DATA_DIR;
    process.env.LIRI_DATA_DIR = dataDir;
    resetSessionRouterStoreForTest();
  });

  afterAll(() => {
    resetSessionRouterStoreForTest();
    if (prevDataDir === undefined) delete process.env.LIRI_DATA_DIR;
    else process.env.LIRI_DATA_DIR = prevDataDir;
    try {
      rmSync(dataDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    } catch {
      /* 临时目录清理失败不影响结论（Windows SQLite 句柄可能未即时释放） */
    }
  });

  it('重复调用返回**同一实例**（且建表成功）', async () => {
    const a = await getSessionRouterStore();
    const b = await getSessionRouterStore();
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    // 建表已生效 ⇒ 读写路径可用（空表读回 null）
    expect(await a!.get('not-exist')).toBeNull();
  });
});
