/**
 * 分区 SQLite 实例的 `close()`（多租户 P5）—— 删租户能真正释放文件句柄的前提
 *
 * 覆盖第 1 步新增/补上的三个**可直接构造**的类：
 *  - `LLMTracker`（原只有 `openScopedSync`，无销毁路径）
 *  - `DBTAORCheckpointStorage`（每会话创建，从不关闭）
 *  - `ProviderTopologyWatcher`（按身份缓存 `Database`，无销毁路径）
 *
 * `ProviderManager` / `BalanceStore` 构造器是私有的、`getInstance()` 会写入静态单例
 * （会污染同进程其他用例）⇒ 它们的 `close()` 由实现复核 + 上报文句柄用例间接覆盖。
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { setUserDataDirOverride } from '@modules/environment';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';
import type { Principal } from '@openliri/kernel/identity/principal.js';
import { LLMTracker } from '../../../src/monitoring/llm/LLMTracker.js';
import { DBTAORCheckpointStorage } from '../../../src/query/DBTAORCheckpointStorage.js';
import { ProviderTopologyWatcher } from '../../../src/ai/providers/TopologyWatcher.js';
import type { TAORCheckpoint } from '../../../src/query/types.js';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'liri-close-'));
  roots.push(root);
  return root;
}

/** 建 `<root>/scoped/app.db` 的父目录，返回路径 */
function makeScopedDbPath(root: string): string {
  const dir = join(root, 'scoped');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'app.db');
}

function tryRemove(dir: string): boolean {
  try {
    rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  setUserDataDirOverride(null);
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      // @ignore-catch — Windows 句柄可能延迟释放，清理失败不影响断言
    }
  }
});

describe('LLMTracker.close()', () => {
  it('关掉分区库后目录可删，且重复 close 不抛（幂等）', () => {
    const root = makeRoot();
    const dbPath = makeScopedDbPath(root);
    const tracker = new LLMTracker();
    tracker.openScopedSync(dbPath);
    expect(existsSync(dbPath)).toBe(true);

    tracker.close();
    tracker.close(); // 幂等

    expect(tryRemove(join(root, 'scoped'))).toBe(true);
  });
});

describe('DBTAORCheckpointStorage.close()', () => {
  it('save 后关连接 ⇒ 目录可删；再 save 会重新开库', async () => {
    const root = makeRoot();
    const dbPath = makeScopedDbPath(root);
    const storage = new DBTAORCheckpointStorage(dbPath);
    const checkpoint = {
      id: 'ckpt-1',
      sessionId: 'sess-1',
      turnCount: 1,
      phase: 'observe',
      budgetState: {},
      conversationSummary: '',
      lastPrompt: '',
      createdAt: Date.now(),
      type: 'manual',
    } as unknown as TAORCheckpoint;

    await storage.save(checkpoint);
    storage.close();
    storage.close(); // 幂等

    expect(tryRemove(join(root, 'scoped'))).toBe(true);

    // 关闭后仍可继续写（initDatabase 以 db 为空为判据 ⇒ 自动重开）
    await storage.save({ ...checkpoint, id: 'ckpt-2' });
    storage.close();
  });
});

describe('ProviderTopologyWatcher.close()', () => {
  it('按身份打开的连接可被 close 释放（幂等）', async () => {
    const root = makeRoot();
    setUserDataDirOverride(root);

    const watcher = new ProviderTopologyWatcher(60_000);
    try {
      // 非本地身份 ⇒ getDb() 打开 `<data>/tenants/acme/app.db`（租户级库）
      await runWithPrincipal(ALICE, () => watcher.start());
      // `setUserDataDirOverride(root)` 设的是**应用根** ⇒ 数据根为 `<root>/data`
      const scopedDir = join(root, 'data', 'tenants', 'acme');
      expect(existsSync(join(scopedDir, 'app.db'))).toBe(true);

      watcher.close();
      watcher.close(); // 幂等

      expect(tryRemove(scopedDir)).toBe(true);
    } finally {
      watcher.stop();
      watcher.close();
    }
  });
});
