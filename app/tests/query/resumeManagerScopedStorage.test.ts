/**
 * 多租户 P1：模块级 `resumeManager` 的检查点存储按**请求身份**解析
 *
 * 缺陷（第二十批如实边界 ②）：`resumeManager = new ResumeManager()` 在 **import 期**构造，
 * 那时没有请求作用域 ⇒ `new DBTAORCheckpointStorage()` 的缺省路径恒为宿主 `app.db`。
 * 后果：租户请求里的 `clearSession`（会话删除）删的是**宿主**库、`scanBudgetSuspends`
 * 扫的也是宿主库；租户分区里的检查点既不参与恢复也无人清理。
 *
 * 本文件锁三件事：
 *   ① 租户与本地身份各自只看自己分区上的检查点；
 *   ② `clearSession` 落在当前身份的分区（删完本租户查不到，且不影响另一身份）；
 *   ③ 删租户时该身份的检查点库被登记器关闭 ⇒ 分区目录真的删掉（Windows 无 EBUSY）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  resolveDataDir,
  setUserDataDirOverride,
} from '../../src/core/paths.js';
import { runWithPrincipal } from '../../src/core/identity/requestScope.js';
import type { Principal } from '../../src/core/identity/principal.js';
import { resetScopedResourcesForTest } from '../../src/core/identity/scopedResources.js';
import { resumeManager } from '../../src/query/ResumeManager.js';
import { DBTAORCheckpointStorage } from '../../src/query/DBTAORCheckpointStorage.js';
import { TAORPhase } from '../../src/query/types.js';
import type { TAORCheckpoint } from '../../src/query/types.js';
import { TokenBudgetStatus } from '../../src/tokenBudget/TokenBudgetController.js';
import type { TokenBudgetState } from '../../src/tokenBudget/TokenBudgetController.js';
import { purgeTenant } from '../../src/runtime/tenantPurge.js';

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

function principalOf(tenantId: string, userId = 'alice'): Principal {
  return { tenantId, userId, roles: [] };
}

/** 在**指定身份作用域**内直接落一个检查点（模拟该身份的 TAORLoop 写过检查点） */
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

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-resume-scoped-'));
  setUserDataDirOverride(root);
});

afterEach(() => {
  setUserDataDirOverride(null);
  resetScopedResourcesForTest();
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // @ignore-catch — Windows 句柄可能延迟释放，清理失败不影响断言
  }
});

describe('resumeManager：检查点存储按身份解析', () => {
  it('租户写入的检查点只对该租户可见（本地身份看不到）', async () => {
    const tenant = principalOf('resume-ten');
    await seedCheckpoint(tenant, 'sess-tenant');

    expect(
      await runWithPrincipal(tenant, () =>
        resumeManager.hasPending('sess-tenant')
      )
    ).toBe(true);
    // 无请求作用域 = 本地身份 ⇒ 查的是宿主库，不含租户分区里的检查点
    expect(await resumeManager.hasPending('sess-tenant')).toBe(false);
  });

  it('clearSession 落在当前身份分区：删掉本租户的，不动另一租户的', async () => {
    const a = principalOf('resume-clear-a');
    const b = principalOf('resume-clear-b');
    await seedCheckpoint(a, 'sess-shared-name');
    await seedCheckpoint(b, 'sess-shared-name');

    expect(
      await runWithPrincipal(a, () =>
        resumeManager.clearSession('sess-shared-name')
      )
    ).toBe(1);
    expect(
      await runWithPrincipal(a, () =>
        resumeManager.hasPending('sess-shared-name')
      )
    ).toBe(false);
    // 同名会话在另一租户的分区里仍然存在（没有跨身份误删）
    expect(
      await runWithPrincipal(b, () =>
        resumeManager.hasPending('sess-shared-name')
      )
    ).toBe(true);
  });

  it('删租户：登记器关闭该身份的检查点库 ⇒ 分区目录真的删掉', async () => {
    const tenantId = 'resume-purge';
    const tenant = principalOf(tenantId);
    await seedCheckpoint(tenant, 'sess-purge');
    // 让 resumeManager 缓存该身份的存储（连接在此打开）
    expect(
      await runWithPrincipal(tenant, () =>
        resumeManager.hasPending('sess-purge')
      )
    ).toBe(true);

    const report = await purgeTenant(tenantId);

    expect(report.removed.tenantDataDir).toBe(true);
    expect(report.blocked.filter((b) => b.path.includes(tenantId))).toEqual([]);
    expect(existsSync(join(resolveDataDir(), 'tenants', tenantId))).toBe(false);
  });
});
