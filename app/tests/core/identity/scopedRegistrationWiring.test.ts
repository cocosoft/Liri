/**
 * 多租户 P5：按身份缓存实例的**登记接线**（第 2 步）
 *
 * 各模块在自己的 `getXxx()` 里创建分区实例后，必须调用
 * `registerScopedResource(ownerKey, closer)`；closer 负责「关连接 + 摘除自己的缓存」。
 * 本文件锁三件事（用**本文件独有**的租户标识，避免进程级缓存污染其他用例）：
 *  ① 以已认证身份取实例 ⇒ 登记条数增加；
 *  ② `closeScopedResourcesForTenant` ⇒ 关闭成功、登记清空；
 *  ③ 关闭后再次取实例 ⇒ 得到**新实例**且重新登记（缓存确实被摘除，不会拿到已关闭实例）。
 *  ④ 本地身份 ⇒ 不登记（桌面端零变更）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { setUserDataDirOverride } from '@openliri/kernel/paths.js';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';
import type { Principal } from '@openliri/kernel/identity/principal.js';
import {
  closeScopedResourcesForTenant,
  resetScopedResourcesForTest,
  scopedResourceCount,
} from '@openliri/kernel/identity/scopedResources.js';
import { getCostRecordRepository } from '../../../src/cost/CostRecordRepository.js';
import { getExecutionStore } from '../../../src/execution/ExecutionStore.js';
import { getLLMTracker } from '../../../src/monitoring/llm/getLLMTracker.js';
import { getCheckpointDatabase } from '../../../src/chat/services/CheckpointDatabase.js';

const roots: string[] = [];

function setupRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'liri-scoped-wiring-'));
  roots.push(root);
  setUserDataDirOverride(root);
  return root;
}

beforeEach(() => {
  // 登记表是**进程级**全局：其他用例文件可能留下未关闭的登记 ⇒ 先清空再断言绝对值
  resetScopedResourcesForTest();
});

afterEach(() => {
  resetScopedResourcesForTest();
  setUserDataDirOverride(null);
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      // @ignore-catch — Windows 句柄可能延迟释放，清理失败不影响断言
    }
  }
});

describe('登记接线：四个代表性模块', () => {
  it('成本仓库 / 执行存储 / LLM 跟踪器 / 检查点库 都会登记，且按租户可整体关闭', async () => {
    setupRoot();
    const alice: Principal = {
      tenantId: 'wire-a',
      userId: 'alice',
      roles: ['user'],
    };

    runWithPrincipal(alice, () => {
      getCostRecordRepository();
      getExecutionStore();
      getLLMTracker();
      getCheckpointDatabase();
    });

    expect(scopedResourceCount()).toBe(4);

    const result = await closeScopedResourcesForTenant('wire-a');
    expect(result.closed).toBe(4);
    expect(result.failed).toEqual([]);
    expect(scopedResourceCount()).toBe(0);

    // 关闭后再次获取 ⇒ 新的实例（缓存已被 closer 摘除），并重新登记
    const again = runWithPrincipal(alice, () => getCostRecordRepository());
    expect(again).toBeDefined();
    expect(scopedResourceCount()).toBe(1);

    await closeScopedResourcesForTenant('wire-a');
  });

  it('只关本租户：另一个租户的登记不受影响', async () => {
    setupRoot();
    const alice: Principal = {
      tenantId: 'wire-b',
      userId: 'alice',
      roles: ['user'],
    };
    const bob: Principal = {
      tenantId: 'wire-c',
      userId: 'bob',
      roles: ['user'],
    };

    runWithPrincipal(alice, () => getLLMTracker());
    runWithPrincipal(bob, () => getLLMTracker());
    expect(scopedResourceCount()).toBe(2);

    const result = await closeScopedResourcesForTenant('wire-b');
    expect(result.closed).toBe(1);
    expect(scopedResourceCount()).toBe(1); // bob 的仍在

    await closeScopedResourcesForTenant('wire-c');
  });

  it('本地身份 ⇒ 不登记（走共享单例，桌面端零变更）', () => {
    setupRoot();

    getCostRecordRepository();
    getLLMTracker();
    getExecutionStore();

    expect(scopedResourceCount()).toBe(0);
  });
});
