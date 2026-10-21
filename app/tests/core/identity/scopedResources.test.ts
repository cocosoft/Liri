/**
 * ScopedResources — 按身份登记/关闭可关闭资源（多租户 P5）
 *
 * 背景：删租户时各模块**各自持有**按身份的 SQLite 实例 Map，`purgeTenant` 没有统一
 * 入口关连接 ⇒ Windows 上分区目录 `rmSync` 失败（台账第十七批实测 `blocked=1`）。
 * 本模块是唯一登记口；本文件只锁**登记/关闭语义**（真句柄释放见
 * `scopedResourcesSqlite.test.ts`）。
 */
import { describe, it, expect, afterEach } from 'bun:test';

import {
  closeAllScopedResources,
  closeScopedResourcesForTenant,
  registerScopedResource,
  resetScopedResourcesForTest,
  scopedResourceCount,
} from '../../../src/core/identity/scopedResources.js';

afterEach(() => {
  resetScopedResourcesForTest();
});

describe('ScopedResources：按租户前缀关闭', () => {
  it('只关该租户的资源，其他租户与 local 不受影响', async () => {
    const closed: string[] = [];
    registerScopedResource('acme:alice', () => {
      closed.push('acme:alice');
    });
    registerScopedResource('acme:bob', () => {
      closed.push('acme:bob');
    });
    registerScopedResource('other:carol', () => {
      closed.push('other:carol');
    });
    registerScopedResource('local:local', () => {
      closed.push('local:local');
    });

    const result = await closeScopedResourcesForTenant('acme');

    expect(result.closed).toBe(2);
    expect(result.failed).toEqual([]);
    expect(closed.sort()).toEqual(['acme:alice', 'acme:bob']);
    // 其余两个仍登记在案
    expect(scopedResourceCount()).toBe(2);
  });

  it('关闭后登记被摘除（重复关闭不会二次调用 closer）', async () => {
    let calls = 0;
    registerScopedResource('acme:alice', () => {
      calls += 1;
    });

    await closeScopedResourcesForTenant('acme');
    const second = await closeScopedResourcesForTenant('acme');

    expect(calls).toBe(1);
    expect(second.closed).toBe(0);
    expect(scopedResourceCount()).toBe(0);
  });

  it('异步 closer 也等它完成后才算 closed', async () => {
    let finished = false;
    registerScopedResource('acme:alice', async () => {
      await new Promise((r) => setTimeout(r, 5));
      finished = true;
    });

    const result = await closeScopedResourcesForTenant('acme');

    expect(result.closed).toBe(1);
    expect(finished).toBe(true);
  });
});

describe('ScopedResources：失败可重跑', () => {
  it('closer 抛错 ⇒ 计入 failed 且**保留登记**（下次能重试成功）', async () => {
    let attempt = 0;
    registerScopedResource('acme:alice', () => {
      attempt += 1;
      if (attempt === 1) throw new Error('database is locked');
    });

    const first = await closeScopedResourcesForTenant('acme');
    expect(first.closed).toBe(0);
    expect(first.failed).toEqual([
      { ownerKey: 'acme:alice', error: 'database is locked' },
    ]);
    expect(scopedResourceCount()).toBe(1);

    const second = await closeScopedResourcesForTenant('acme');
    expect(second.closed).toBe(1);
    expect(second.failed).toEqual([]);
    expect(scopedResourceCount()).toBe(0);
  });
});

describe('ScopedResources：dispose / 校验 / 全量关闭', () => {
  it('dispose 只摘除登记，不调用 closer', async () => {
    let calls = 0;
    const dispose = registerScopedResource('acme:alice', () => {
      calls += 1;
    });

    dispose();
    dispose(); // 幂等
    const result = await closeScopedResourcesForTenant('acme');

    expect(calls).toBe(0);
    expect(result.closed).toBe(0);
    expect(scopedResourceCount()).toBe(0);
  });

  it('归属键非法（无冒号 / 空段）⇒ 抛 TypeError（不静默接受）', () => {
    expect(() => registerScopedResource('acme', () => {})).toThrow(TypeError);
    expect(() => registerScopedResource(':alice', () => {})).toThrow(TypeError);
    expect(() => registerScopedResource('acme:', () => {})).toThrow(TypeError);
  });

  it('closeAll 关闭全部（含 local）', async () => {
    const closed: string[] = [];
    registerScopedResource('acme:alice', () => {
      closed.push('acme:alice');
    });
    registerScopedResource('local:local', () => {
      closed.push('local:local');
    });

    const result = await closeAllScopedResources();

    expect(result.closed).toBe(2);
    expect(closed.sort()).toEqual(['acme:alice', 'local:local']);
    expect(scopedResourceCount()).toBe(0);
  });
});
