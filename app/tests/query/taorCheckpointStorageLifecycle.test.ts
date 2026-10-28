/**
 * 多租户 P5：TAOR 检查点存储的**生命周期归属**
 *
 * 背景：`DBTAORCheckpointStorage` 由 `TAORLoop` **每循环新建**，长期不关会在分区目录
 * 残留 `app.db` 文件句柄（Windows 上删租户目录 `blocked`）。归属记在
 * `query/checkpointStorageLifecycle`（WeakSet），不在 `TAORLoop` 上加字段 ——
 * 那个文件已在 R04-001 的 2000 行上限边缘。
 *
 * 锁三件事：
 *  ① `createOwned()` 创建的 ⇒ `closeOwned` 真的关（目录可删）；
 *  ② 调用方注入 / 未托管的 ⇒ **不动**（生命周期归调用方）；
 *  ③ `TAORLoop` 缺省自建 ⇒ 其存储是"托管"的；显式注入 ⇒ 不托管。
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  closeOwned,
  createOwned,
} from '../../src/query/checkpointStorageLifecycle.js';
import { TAORLoop } from '../../src/query/TAORLoop.js';
import type { QueryEngine } from '../../src/query/QueryEngine.js';
import type {
  TAORCheckpoint,
  TAORCheckpointStorage,
} from '../../src/query/types.js';
import { setUserDataDirOverride } from '@modules/environment';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';
import type { Principal } from '@openliri/kernel/identity/principal.js';
import { resetScopedResourcesForTest } from '@openliri/kernel/identity/scopedResources.js';

const ALICE: Principal = { tenantId: 'taor-life', userId: 'alice', roles: [] };
const roots: string[] = [];

const CHECKPOINT = {
  id: 'ckpt-life',
  sessionId: 'sess-life',
  turnCount: 1,
  phase: 'observe',
  budgetState: {},
  conversationSummary: '',
  lastPrompt: '',
  createdAt: Date.now(),
  type: 'manual',
} as unknown as TAORCheckpoint;

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'liri-taor-life-'));
  roots.push(root);
  setUserDataDirOverride(root);
  return root;
}

function makeFakeStorage(calls: { closed: number }): TAORCheckpointStorage {
  return {
    close: () => {
      calls.closed += 1;
    },
  } as unknown as TAORCheckpointStorage;
}

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

describe('checkpointStorageLifecycle：托管 vs 未托管', () => {
  it('createOwned 创建的 ⇒ 收尾真的关闭（租户目录可删）', async () => {
    const root = makeRoot();
    // `setUserDataDirOverride(root)` 设的是**应用根** ⇒ 数据根为 `<root>/data`
    // 租户级库（§6.1）：检查点落 `tenants/<t>/app.db`（不再含 `users/<u>`）
    const scopedDir = join(root, 'data', 'tenants', 'taor-life');

    const storage = await runWithPrincipal(ALICE, async () => {
      // 在身份作用域内创建 ⇒ 默认路径落在分区目录
      const created = createOwned();
      await created.save(CHECKPOINT);
      return created;
    });

    expect(existsSync(join(scopedDir, 'app.db'))).toBe(true);

    await closeOwned(storage);

    expect(() =>
      rmSync(scopedDir, { recursive: true, force: true })
    ).not.toThrow();
    expect(existsSync(scopedDir)).toBe(false);
  });

  it('未托管的（调用方注入）⇒ 不动它的生命周期', async () => {
    const calls = { closed: 0 };
    await closeOwned(makeFakeStorage(calls));
    expect(calls.closed).toBe(0);
  });

  it('重复收尾幂等（第二次不再调用 close）', async () => {
    makeRoot();
    const storage = await runWithPrincipal(ALICE, async () => {
      const created = createOwned();
      await created.save(CHECKPOINT);
      return created;
    });

    await closeOwned(storage);
    await closeOwned(storage); // 已从 WeakSet 摘除 ⇒ 不再调用
  });
});

describe('TAORLoop：缺省自建 vs 显式注入', () => {
  it('缺省 ⇒ 存储由循环托管（收尾会关）；注入 ⇒ 不托管', async () => {
    makeRoot();

    const loop = new TAORLoop({} as unknown as QueryEngine) as unknown as {
      checkpointStorage: TAORCheckpointStorage;
    };
    // 托管：closeOwned 会真的调用 close（这里为未开库实例 ⇒ 无副作用）
    await closeOwned(loop.checkpointStorage);

    const calls = { closed: 0 };
    const injected = makeFakeStorage(calls);
    const loop2 = new TAORLoop({} as unknown as QueryEngine, {
      checkpointStorage: injected,
    }) as unknown as { checkpointStorage: TAORCheckpointStorage };

    await closeOwned(loop2.checkpointStorage);
    expect(calls.closed).toBe(0);
  });
});
