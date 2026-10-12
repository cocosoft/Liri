// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Task 6（债二-预算挂起续跑）：batch（TAOR）链日预算耗尽 ⇒ 挂起落点 + 启动扫描排除（反目标①）。
//
// 门控：`FEATURE_BUDGET_SUSPEND_RESUME`（**默认开**；`=false` 即关）⇒ 关时零行为变更（不落标记、不登记，但日志照打）。
// 反目标①：`budget_suspend` 检查点**不参与**启动扫描（`scanPending`/`hasPending`）⇒
// 重启后**不自动续跑**（静默烧额度）；普通 `auto` 检查点仍照旧被扫描（不误伤）。

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { handleTaorBudgetExhaustion } from '../../src/query/taor/budgetSuspendHook.js';
import {
  getBudgetSuspendCoordinator,
  resetBudgetSuspendForTest,
} from '../../src/query/budgetSuspend.js';
import { ResumeManager } from '../../src/query/ResumeManager.js';
import { MemoryCheckpointStorage } from '../../src/query/taor/MemoryCheckpointStorage.js';
import { TAORPhase } from '../../src/query/types.js';
import type { TAORCheckpoint } from '../../src/query/types.js';
import { addLogHandler } from '../../src/monitoring/logs/Logger.js';
import { TokenBudgetStatus } from '../../src/tokenBudget/TokenBudgetController.js';
import type { TokenBudgetState } from '../../src/tokenBudget/TokenBudgetController.js';

const FLAG = 'FEATURE_BUDGET_SUSPEND_RESUME';

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

function makeCheckpoint(
  sessionId: string,
  type: TAORCheckpoint['type']
): TAORCheckpoint {
  return {
    id: `cp-${sessionId}`,
    sessionId,
    turnCount: 1,
    phase: TAORPhase.THINK,
    budgetState,
    conversationSummary: '',
    lastPrompt: '',
    createdAt: Date.now(),
    type,
    messageCount: 1,
  };
}

describe('Task 6：batch 链日预算耗尽挂起', () => {
  let prevFlag: string | undefined;

  beforeEach(() => {
    prevFlag = process.env[FLAG];
    resetBudgetSuspendForTest();
  });
  afterEach(() => {
    if (prevFlag === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prevFlag;
    resetBudgetSuspendForTest();
  });

  it('开关开 + 耗尽 ⇒ 落 type=budget_suspend 检查点 + 协调器登记 chain=taor', async () => {
    process.env[FLAG] = 'true';
    const saved: string[] = [];

    await handleTaorBudgetExhaustion({
      sessionId: 'sess-taor',
      logContext: { turnCount: 3 },
      saveCheckpoint: async (type) => {
        saved.push(type);
        return 'cp-taor-1';
      },
    });

    expect(saved).toEqual(['budget_suspend']);
    const coordinator = getBudgetSuspendCoordinator();
    expect(coordinator.isSuspended('sess-taor')).toBe(true);
    const list = coordinator.list();
    expect(list.length).toBe(1);
    expect(list[0].chain).toBe('taor');
    expect(list[0].checkpointRef).toBe('cp-taor-1');
  });

  it('开关关 ⇒ 不落、不登记（但日志照打）', async () => {
    process.env[FLAG] = 'false'; // 默认已翻为开 ⇒ 显式 false 才是「关」（`feature()`：env > 变体 > 静态默认）
    const saved: string[] = [];
    const logs: unknown[] = [];
    const off = addLogHandler((entry) => {
      if (entry.message.startsWith('dailyBudget:exhausted_abort')) {
        logs.push(entry.data);
      }
    });

    try {
      await handleTaorBudgetExhaustion({
        sessionId: 'sess-taor',
        logContext: { turnCount: 3 },
        saveCheckpoint: async (type) => {
          saved.push(type);
          return 'cp-taor-1';
        },
      });
    } finally {
      off();
    }

    expect(saved).toEqual([]);
    expect(getBudgetSuspendCoordinator().isSuspended('sess-taor')).toBe(false);
    expect(logs.length).toBe(1);
  });
});

describe('Task 6：启动扫描排除 budget_suspend（反目标①）', () => {
  it('budget_suspend ⇒ scanPending 返回空、hasPending=false', async () => {
    const storage = new MemoryCheckpointStorage();
    await storage.save(makeCheckpoint('sess-budget', 'budget_suspend'));

    const rm = new ResumeManager(storage);
    expect(await rm.scanPending()).toEqual([]);
    expect(await rm.hasPending('sess-budget')).toBe(false);
  });

  it('普通 auto 检查点仍照旧被扫描（不误伤）', async () => {
    const storage = new MemoryCheckpointStorage();
    await storage.save(makeCheckpoint('sess-auto', 'auto'));

    const rm = new ResumeManager(storage);
    const candidates = await rm.scanPending();
    expect(candidates.map((c) => c.sessionId)).toEqual(['sess-auto']);
    expect(await rm.hasPending('sess-auto')).toBe(true);
  });
});

// ─── I2（最终整支评审）：启动扫描须把 budget_suspend **登记为"待放行挂起"** ────────────
//
// 缺陷：spec §4.4 要求"重启后把 budget_suspend 条目交协调器登记为待放行"，实现只做了
// `scanPending`/`hasPending` 的**排除** ⇒ 重启后挂起**不可见也不可唤醒**（`list()` 为空）。
// 本判据（scanBudgetSuspends）只**筛出**这些检查点供启动期登记，**绝不**触发续跑。
describe('I2：scanBudgetSuspends 筛出挂起检查点（只登记、不续跑）', () => {
  it('budget_suspend ⇒ 被筛出；普通 auto ⇒ 不被筛出', async () => {
    const storage = new MemoryCheckpointStorage();
    await storage.save(makeCheckpoint('sess-budget', 'budget_suspend'));
    await storage.save(makeCheckpoint('sess-auto', 'auto'));

    const rm = new ResumeManager(storage);
    const suspended = await rm.scanBudgetSuspends();

    expect(suspended.map((c) => c.sessionId)).toEqual(['sess-budget']);
    // 与既有"排除"负向测试并存：挂起**不**进入自动恢复扫描（普通 auto 仍照旧被扫描）
    expect((await rm.scanPending()).map((c) => c.sessionId)).toEqual([
      'sess-auto',
    ]);
    expect(await rm.hasPending('sess-budget')).toBe(false);
  });
});
