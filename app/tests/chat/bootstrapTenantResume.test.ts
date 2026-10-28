/**
 * 多租户 P5：启动期**按身份**扫描待恢复检查点（第二十二批的如实边界 ①）
 *
 * 缺陷：`ChatBootstrap.resumePendingSessions()` 在启动期跑，**没有请求作用域** ⇒
 * `resumeManager` 只能拿宿主 `app.db`。租户分区里的检查点因此既不参与恢复，也没人清理。
 *
 * 本文件锁三件事：
 *   ① `scopedResumeScan` 真的把作用域切到该身份（只看到该身份的检查点）；
 *   ② 临时存储用完即关（Windows 上目录可删 ⇒ 没有残留句柄）；
 *   ③ 启动接线：`resumePendingSessions()` 除本地外，会对**每个已绑定租户的身份**扫一遍
 *      （本地库看不到租户检查点，租户扫描能看到并注入恢复摘要）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { resolveDataDir, setUserDataDirOverride } from '@modules/environment';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';
import type { Principal } from '@openliri/kernel/identity/principal.js';
import { resetScopedResourcesForTest } from '@openliri/kernel/identity/scopedResources.js';
import { DBTAORCheckpointStorage } from '../../src/query/DBTAORCheckpointStorage.js';
import { withScopedResumeManager } from '../../src/query/scopedResumeScan.js';
import { TAORPhase } from '../../src/query/types.js';
import type { TAORCheckpoint } from '../../src/query/types.js';
import { TokenBudgetStatus } from '../../src/tokenBudget/TokenBudgetController.js';
import type { TokenBudgetState } from '../../src/tokenBudget/TokenBudgetController.js';
import { AuthUserStore } from '../../src/infrastructure/http/auth/AuthUserStore.js';
import { __setAuthUserStoreForTest } from '../../src/infrastructure/http/handlers/auth-handlers.js';
import { ChatBootstrap } from '../../src/chat/manager/bootstrap.js';
import type { ChatBootstrapDeps } from '../../src/chat/manager/bootstrap.js';
import type { TAORLoop } from '../../src/query/TAORLoop.js';

const budgetState: TokenBudgetState = {
  status: TokenBudgetStatus.NORMAL,
  currentTokens: 0,
  maxTokens: 100000,
  maxOutputTokens: 4096,
  percentUsed: 0,
  isWarning: false,
  isCritical: false,
  remainingTokens: 100000,
  remainingOutputTokens: 4096,
  resetAt: 0,
  totalTokensUsed: 0,
  totalCacheReadTokens: 0,
  totalCacheCreationTokens: 0,
  totalOutputTokensUsed: 0,
  messagesProcessed: 0,
  shouldCompact: false,
  modelName: 'test-model',
};

function makeCheckpoint(sessionId: string): TAORCheckpoint {
  return {
    id: `cp-${sessionId}`,
    sessionId,
    turnCount: 1,
    phase: TAORPhase.THINK,
    budgetState,
    conversationSummary: '',
    lastPrompt: '',
    createdAt: Date.now(),
    type: 'auto',
    messageCount: 1,
  };
}

function principalOf(tenantId: string, userId: string): Principal {
  return { tenantId, userId, roles: [] };
}

/** 在指定身份分区里落一个检查点（模拟该身份上一次跑到一半就被中断） */
async function seedCheckpoint(
  principal: Principal,
  sessionId: string
): Promise<void> {
  await runWithPrincipal(principal, async () => {
    const storage = new DBTAORCheckpointStorage();
    await storage.save(makeCheckpoint(sessionId));
    storage.close();
  });
}

/** 只填恢复路径会用到的依赖；其余字段在 `resumePendingSessions` 里不会被读到 */
function makeDeps(loops: Array<{ sessionId: string; summary: string[] }>): {
  deps: ChatBootstrapDeps;
} {
  const deps = {
    getSessionGateway: () => ({ getMessages: async () => [] }),
    getTokenBudget: () => ({
      getCurrentBudgetState: () => ({ totalTokensUsed: 0 }),
    }),
    getOrCreateTAORLoop: (sessionId: string) => {
      const record = { sessionId, summary: [] as string[] };
      loops.push(record);
      return {
        resumeFromCheckpoint: () => {},
        injectSteering: (text: string) => {
          record.summary.push(text);
        },
      } as unknown as TAORLoop;
    },
  } as unknown as ChatBootstrapDeps;
  return { deps };
}

type BootstrapInternals = {
  resumePendingSessions(): Promise<void>;
};

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-tenant-resume-'));
  setUserDataDirOverride(root);
});

afterEach(() => {
  setUserDataDirOverride(null);
  resetScopedResourcesForTest();
  // 用户存储是模块级单例：换回一个**空**存储，避免本文件的租户用户泄漏给其他用例文件
  __setAuthUserStoreForTest(
    new AuthUserStore(
      join(mkdtempSync(join(tmpdir(), 'liri-auth-clean-')), 'users.json')
    )
  );
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // @ignore-catch — Windows 句柄可能延迟释放，清理失败不影响断言
  }
});

describe('withScopedResumeManager：作用域 + 存储生命周期', () => {
  it('扫到的是该身份的检查点；临时存储用完即关（分区目录可删）', async () => {
    const identity = { tenantId: 'resume-scope', userId: 'alice' };
    await seedCheckpoint(principalOf(identity.tenantId, identity.userId), 's1');

    let seen = false;
    await withScopedResumeManager(identity, async (manager) => {
      seen = await manager.hasPending('s1');
    });
    expect(seen).toBe(true);

    // 同租户的**另一个身份**看不到它（路径到"人"这一级，不是到租户）
    let otherSees = true;
    await withScopedResumeManager(
      { tenantId: 'resume-scope', userId: 'bob' },
      async (manager) => {
        otherSees = await manager.hasPending('s1');
      }
    );
    expect(otherSees).toBe(false);

    // 存储已关闭 ⇒ Windows 上分区目录可整块删除（无残留句柄）
    const tenantRoot = join(resolveDataDir(), 'tenants', 'resume-scope');
    expect(existsSync(tenantRoot)).toBe(true);
    rmSync(tenantRoot, { recursive: true, force: true, maxRetries: 5 });
    expect(existsSync(tenantRoot)).toBe(false);
  });
});

describe('ChatBootstrap：启动期按身份恢复', () => {
  it('本地扫不到租户检查点，按身份扫能看到并注入恢复摘要', async () => {
    const tenantId = 'boot-ten';
    const userStore = new AuthUserStore(join(root, 'users.json'));
    userStore.addUser('alice', 'pw', 'user', tenantId);
    userStore.addUser('bob', 'pw', 'user'); // 未绑定租户 ⇒ 本地身份，不在租户扫描范围
    __setAuthUserStoreForTest(userStore);

    await seedCheckpoint(principalOf(tenantId, 'alice'), 'sess-tenant-boot');

    const loops: Array<{ sessionId: string; summary: string[] }> = [];
    const { deps } = makeDeps(loops);
    const internals = new ChatBootstrap(deps) as unknown as BootstrapInternals;

    await internals.resumePendingSessions();

    // 恰好恢复这一个租户会话（本地扫描扫不到它，也不会重复恢复）
    expect(loops.map((l) => l.sessionId)).toEqual(['sess-tenant-boot']);
    expect(loops[0].summary.length).toBe(1);
    expect(loops[0].summary[0]).toContain('会话已从断点恢复');
  });

  it('单个身份的分区库打不开 ⇒ 该身份被跳过，其他身份照常恢复', async () => {
    const userStore = new AuthUserStore(join(root, 'users.json'));
    userStore.addUser('mallory', 'pw', 'user', 'boot-bad');
    userStore.addUser('carol', 'pw', 'user', 'boot-ok');
    __setAuthUserStoreForTest(userStore);

    // 让 mallory 的分区"库"是个**目录**：sqlite 打不开（错误由 `scanPending` 内部吞掉并
    // 返回空 ⇒ 启动不中断；外层 try/catch 是第二道保险，防存储构造期抛错）
    mkdirSync(
      join(
        resolveDataDir(),
        'tenants',
        'boot-bad',
        'users',
        'mallory',
        'app.db'
      ),
      { recursive: true }
    );
    await seedCheckpoint(principalOf('boot-ok', 'carol'), 'sess-ok');

    const loops: Array<{ sessionId: string; summary: string[] }> = [];
    const { deps } = makeDeps(loops);
    const internals = new ChatBootstrap(deps) as unknown as BootstrapInternals;

    await internals.resumePendingSessions();

    // 坏身份被隔离，好身份照常恢复（顺序按 tenantId 排序：boot-bad → boot-ok）
    expect(loops.map((l) => l.sessionId)).toEqual(['sess-ok']);
  });
});
