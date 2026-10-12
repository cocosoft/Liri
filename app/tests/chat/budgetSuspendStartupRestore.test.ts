// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// I2（最终整支评审）：启动扫描把 `budget_suspend` **登记为"待放行挂起"**。
//
// 缺陷：spec §4.4 要求"重启后把 `budget_suspend` 条目交协调器登记为待放行"，实现只做了
// `ResumeManager.scanPending`/`hasPending` 的**排除** ⇒ 重启后挂起**不可见也不可唤醒**
// （`coordinator.list()` 为空），§6.5"挂起可见"落空。
// 修复：启动期**两支**扫描（batch = `type='budget_suspend'`；stream = 会话检查点的
// `metadata.budgetSuspend`）⇒ 只登记、**绝不**自动续跑（守反目标①）。
//
// 门控：`FEATURE_BUDGET_SUSPEND_RESUME`（默认关）⇒ 关时零行为变更。

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ChatBootstrap } from '../../src/chat/manager/bootstrap.js';
import type { ChatBootstrapDeps } from '../../src/chat/manager/bootstrap.js';
import {
  getBudgetSuspendCoordinator,
  resetBudgetSuspendForTest,
} from '../../src/query/budgetSuspend.js';
import type { TAORCheckpoint } from '../../src/query/types.js';

const FLAG = 'FEATURE_BUDGET_SUSPEND_RESUME';

function makeDeps(opts: {
  batch: TAORCheckpoint[];
  streamSessions: string[];
  streamCheckpoints: Record<string, unknown[]>;
  onGetLoop: () => void;
}): ChatBootstrapDeps {
  return {
    getSessionGateway: () =>
      ({
        listSessions: async () =>
          opts.streamSessions.map((id) => ({ id, status: 'active' })),
      }) as never,
    getChatSessions: () => new Map(),
    getSessionAccess: () =>
      ({
        ensureActivityTracker: () => {},
        hydrateSession: () => ({}),
      }) as never,
    getTokenBudget: () =>
      ({ getCurrentBudgetState: () => ({ totalTokensUsed: 0 }) }) as never,
    getOrCreateTAORLoop: () => {
      opts.onGetLoop();
      return {} as never;
    },
    getLlmClient: () => undefined,
    isDurableResumeEnabled: () => false,
    shouldPersistRecalculatedTotal: () => false,
    getCheckpointService: () =>
      ({
        listCheckpoints: async (sid: string) =>
          opts.streamCheckpoints[sid] ?? [],
      }) as never,
    scanBudgetSuspendCheckpoints: async () => opts.batch,
  };
}

describe('I2：启动扫描登记 budget_suspend（两链，只登记不续跑）', () => {
  beforeEach(() => {
    resetBudgetSuspendForTest();
  });
  afterEach(() => {
    delete process.env[FLAG];
    resetBudgetSuspendForTest();
  });

  it('开关开 ⇒ 两链各登记一条；不触发任何自动续跑', async () => {
    process.env[FLAG] = 'true';
    let loopCalls = 0;
    const deps = makeDeps({
      batch: [{ id: 'cp-batch', sessionId: 's-batch' } as TAORCheckpoint],
      streamSessions: ['s-stream'],
      streamCheckpoints: {
        's-stream': [
          { id: 'cp-stream', metadata: { budgetSuspend: { suspendedAt: 1 } } },
        ],
      },
      onGetLoop: () => {
        loopCalls += 1;
      },
    });

    await new ChatBootstrap(deps).resumeBudgetSuspends();

    const list = getBudgetSuspendCoordinator().list();
    expect(Object.fromEntries(list.map((e) => [e.sessionId, e.chain]))).toEqual(
      {
        's-batch': 'taor',
        's-stream': 'stream',
      }
    );
    expect(list.every((e) => e.reason === 'restored_budget_suspend')).toBe(
      true
    );
    // 反目标①：只登记、绝不自动续跑（batch 自动恢复会经 getOrCreateTAORLoop 建循环）
    expect(loopCalls).toBe(0);
  });

  it('开关关 ⇒ 零登记（零行为变更）', async () => {
    delete process.env[FLAG];
    const deps = makeDeps({
      batch: [{ id: 'cp-batch', sessionId: 's-batch' } as TAORCheckpoint],
      streamSessions: ['s-stream'],
      streamCheckpoints: {
        's-stream': [{ id: 'cp-stream', metadata: { budgetSuspend: {} } }],
      },
      onGetLoop: () => {},
    });

    await new ChatBootstrap(deps).resumeBudgetSuspends();

    expect(getBudgetSuspendCoordinator().list()).toEqual([]);
  });

  it('无 budgetSuspend 标记的流式检查点 ⇒ 不登记（不误伤普通检查点）', async () => {
    process.env[FLAG] = 'true';
    const deps = makeDeps({
      batch: [],
      streamSessions: ['s-plain'],
      streamCheckpoints: {
        's-plain': [{ id: 'cp-plain', metadata: { model: 'x' } }],
      },
      onGetLoop: () => {},
    });

    await new ChatBootstrap(deps).resumeBudgetSuspends();

    expect(getBudgetSuspendCoordinator().list()).toEqual([]);
  });
});
