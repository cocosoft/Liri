// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T10（Spec `daily-budget-over-limit-ux.md` §1.2 G-2 / §5-D-1 D）：
// **长程任务自定义 `ExecutorFn` 补计账 + 闸门**。长程任务走**非 chat 管线**（默认执行器直调
// `AIService.generate`）⇒ 不经流式闸门、也不经非流式闸门 ⇒ 此前可在预算耗尽后继续跑（G-2 绕过）。
//
// 断言口径（决策规则层；接线由既有 `LongRunningTaskOrchestrator` + `test:guarded` 回归兜底）：
//  ① 计账：自定义执行器回传 `usage` ⇒ 计入日预算（与默认执行器同口径）；
//  ② 闸门：超限 ⇒ 抛 `DAILY_BUDGET_EXCEEDED` 且**不发起模型调用**；
//  ③ 中止即可续跑（Spec §10-8：**不做**新挂起机制）：抛出点在阶段边界之后 ⇒ checkpoint 保留；
//  ④ 兼容：自定义执行器返回纯文本（旧形态）⇒ 不记账、不报错。

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LongRunningTaskOrchestrator } from '../../src/tasks/LongRunningTaskOrchestrator';
import { taskOrchestrator } from '../../src/tasks/TaskOrchestrator';
import {
  closePdcaCheckpointStore,
  readPdcaCheckpoint,
} from '../../src/tasks/PdcaWorkItemBridge';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
} from '../../src/query/DailyBudgetManager';
import { AppError } from '@modules/error';

// 隔离计划持久化目录：避免污染用户数据（~/.pyapp/data/plans/）
taskOrchestrator.setPlansDir(mkdtempSync(join(tmpdir(), 'plans-t10-')));
// GAI-3：checkpoint / WorkItem 迁入 app.db ⇒ 隔离临时库，避免污染真实 ~/.pyapp/data/app.db
const dataDir = mkdtempSync(join(tmpdir(), 'pdca-t10-'));
process.env.LIRI_DATA_DIR = dataDir;

afterAll(() => {
  // 先关闭 DB 连接（WAL 句柄），否则 Windows 下 rmSync 报 EBUSY
  closePdcaCheckpointStore();
  delete process.env.LIRI_DATA_DIR;
  // app.db 句柄可能未即时释放（Windows EBUSY）⇒ 重试删除，且清理失败不影响断言结果
  try {
    rmSync(dataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {
    /* 临时目录清理失败不影响测试结论 */
  }
});

/** 仅暴露本用例用到的私有入口（与既有 LRO 测试同模式） */
type OrchestratorWithPrivates = {
  executePlanPhase: (
    description: string,
    sessionId: string
  ) => Promise<unknown>;
};

const SESSION_ID = 'session-t10';
/** 可被解析的规划输出（PLAN 阶段直接 JSON.parse 该文本） */
const PLAN_JSON = JSON.stringify({
  steps: ['步骤A'],
  acceptanceCriteria: ['grep 在 src 下命中 foo'],
});
const USAGE_TOKENS = 50; // prompt 30 + completion 20

describe('T10：长程任务执行器的日预算收口（G-2/D）', () => {
  beforeEach(() => {
    resetDailyBudgetForTest();
  });
  afterEach(() => {
    resetDailyBudgetForTest();
  });

  it('自定义 ExecutorFn 回传 usage ⇒ 用量计入日预算（与默认执行器同口径）', async () => {
    let calls = 0;
    const orchestrator = new LongRunningTaskOrchestrator(
      `t10-account-${Date.now()}`,
      async () => {
        calls += 1;
        return {
          content: PLAN_JSON,
          usage: { prompt_tokens: 30, completion_tokens: 20 },
        };
      }
    ) as unknown as OrchestratorWithPrivates;

    const before = getDailyBudget().getMode().todayUsed;
    await orchestrator.executePlanPhase('T10 计账', SESSION_ID);
    const after = getDailyBudget().getMode().todayUsed;

    expect(calls).toBeGreaterThan(0);
    // 每一次执行器调用都按其回传的 usage 计入（不依赖具体调用次数，避免被内部补全调用扰动）
    expect(after).toBe(before + USAGE_TOKENS * calls);
  });

  it('撞限 ⇒ 抛 DAILY_BUDGET_EXCEEDED、不发起模型调用，且 checkpoint 保留（可续跑）', async () => {
    const budget = getDailyBudget();
    budget.setLimit(10);
    budget.recordUsage(10); // 已达上限 ⇒ locked
    expect(budget.getMode().mode).toBe('locked');

    const taskId = `t10-gate-${Date.now()}`;
    let calls = 0;
    const orchestrator = new LongRunningTaskOrchestrator(taskId, async () => {
      calls += 1;
      return 'mock';
    }) as unknown as OrchestratorWithPrivates;

    let thrown: unknown;
    try {
      await orchestrator.executePlanPhase('T10 闸门', SESSION_ID);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe('DAILY_BUDGET_EXCEEDED');
    expect((thrown as AppError).context?.dailyLimit).toBe(10);
    // 闸门在**模型调用之前** ⇒ 执行器一次都没被调用
    expect(calls).toBe(0);
    // 中止但**不丢进度**：阶段边界（setPhase('plan')）已落 checkpoint ⇒ 放行后可续跑/重发
    expect((await readPdcaCheckpoint(taskId))?.phase).toBe('plan');
  });

  it('自定义执行器返回纯文本（旧形态）⇒ 不记账、不报错（向后兼容）', async () => {
    const orchestrator = new LongRunningTaskOrchestrator(
      `t10-compat-${Date.now()}`,
      async () => 'mock'
    ) as unknown as OrchestratorWithPrivates;

    const before = getDailyBudget().getMode().todayUsed;
    // 'mock' 非 JSON ⇒ PLAN 阶段回落"单步骤"计划（既有行为，不抛）
    await orchestrator.executePlanPhase('T10 兼容', SESSION_ID);

    expect(getDailyBudget().getMode().todayUsed).toBe(before);
  });
});
