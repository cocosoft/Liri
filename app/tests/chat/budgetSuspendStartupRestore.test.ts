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
// 门控：`FEATURE_BUDGET_SUSPEND_RESUME`（**默认开**；`=false` 即关）⇒ 关时零行为变更。

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
    // B3-3：启动登记处一并装配唤醒端口（本用例只验登记语义 ⇒ 空实现）
    installBudgetSuspendResume: () => {},
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
    process.env[FLAG] = 'false'; // 默认已翻为开 ⇒ 显式 false 才是「关」
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

/**
 * `BUDGET-SUSPEND-RESTART-IDEMPOTENT`（2026-10-17）：流式支路**只认最新检查点**。
 *
 * 缺陷（真机实证）：原判据 `checkpoints.find(cp => cp.metadata?.budgetSuspend !== undefined)`
 * **扫全部**检查点 ⇒ 只要该会话历史上挂起过一次，其后每次重启/重载都被重新登记为「已挂起」——
 * 即便用户早已放行续跑（同一会话当日被登记 **10 次**、用户被迫反复点「继续」）。
 *
 * 判据（与事实源构造一致）：挂起点是**当轮最后一条**检查点（`suspend()` 在轮间安全点落盘）
 * ⇒ 其后出现任何更新的检查点（普通 `auto` 或放行成功后的 `budget_resumed` 标记）即证明该挂起
 * 已过期。修复前 ①/③/④ 必然红。
 */
describe('BUDGET-SUSPEND-RESTART-IDEMPOTENT：只认最新检查点', () => {
  beforeEach(() => {
    resetBudgetSuspendForTest();
  });
  afterEach(() => {
    delete process.env[FLAG];
    resetBudgetSuspendForTest();
  });

  /** 挂起点（createdAt 1000）+ 其后一条普通检查点（createdAt 2000） */
  const resumedThenPlain = [
    {
      id: 'cp-suspend',
      createdAt: 1000,
      metadata: { budgetSuspend: { suspendedAt: 1000 } },
    },
    { id: 'cp-later', createdAt: 2000, metadata: { model: 'x' } },
  ];

  it('① 挂起点之后有更新的检查点 ⇒ **不**登记（该挂起已过期）', async () => {
    process.env[FLAG] = 'true';
    await new ChatBootstrap(
      makeDeps({
        batch: [],
        streamSessions: ['s-resumed'],
        streamCheckpoints: { 's-resumed': resumedThenPlain },
        onGetLoop: () => {},
      })
    ).resumeBudgetSuspends();

    expect(getBudgetSuspendCoordinator().list()).toEqual([]);
  });

  it('② 最新一条仍是挂起点 ⇒ 登记（零回归），且 checkpointRef = 该挂起点', async () => {
    process.env[FLAG] = 'true';
    await new ChatBootstrap(
      makeDeps({
        batch: [],
        streamSessions: ['s-still'],
        streamCheckpoints: {
          's-still': [
            { id: 'cp-old', createdAt: 1000, metadata: { model: 'x' } },
            {
              id: 'cp-suspend-latest',
              createdAt: 2000,
              metadata: { budgetSuspend: { suspendedAt: 2000 } },
            },
          ],
        },
        onGetLoop: () => {},
      })
    ).resumeBudgetSuspends();

    const list = getBudgetSuspendCoordinator().list();
    expect(list.map((e) => e.sessionId)).toEqual(['s-still']);
    expect(list[0]?.checkpointRef).toBe('cp-suspend-latest');
  });

  it('③ 顺序无关：同一组检查点**倒序**返回（File 存储 = 新在前）⇒ 结论不变', async () => {
    process.env[FLAG] = 'true';
    await new ChatBootstrap(
      makeDeps({
        batch: [],
        streamSessions: ['s-reversed'],
        // ⚠️ 两种存储顺序相反（File 新在前 / DB 旧在前）⇒ 判据不得依赖数组下标
        streamCheckpoints: { 's-reversed': [...resumedThenPlain].reverse() },
        onGetLoop: () => {},
      })
    ).resumeBudgetSuspends();

    expect(getBudgetSuspendCoordinator().list()).toEqual([]);
  });

  it('④ 放行成功落下的 `budget_resumed` 标记（更新的空消息检查点）⇒ 视作已恢复 ⇒ 不登记', async () => {
    process.env[FLAG] = 'true';
    await new ChatBootstrap(
      makeDeps({
        batch: [],
        streamSessions: ['s-marked'],
        streamCheckpoints: {
          's-marked': [
            {
              id: 'cp-suspend',
              createdAt: 1000,
              metadata: { budgetSuspend: { suspendedAt: 1000 } },
            },
            {
              id: 'cp-resumed',
              createdAt: 3000,
              metadata: { budgetResumed: { resumedAt: 3000 } },
            },
          ],
        },
        onGetLoop: () => {},
      })
    ).resumeBudgetSuspends();

    expect(getBudgetSuspendCoordinator().list()).toEqual([]);
  });
});
