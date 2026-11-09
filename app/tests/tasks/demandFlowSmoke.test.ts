// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * B10（2026-11-09）：demand（许愿式）**全链路集成烟测**。
 *
 * 目的：B2–B8 各自只有单点单测，跨批的接线（谁调用谁、顺序是否正确）没有回归保护。
 * 本文件用真实编排器 + 桩执行器，把一条 demand 任务从"计划"跑到"终态回执"：
 *
 *  ① B2 验收前置：demand 计划缺逐条验收标准 ⇒ 重问一次，仍缺则 `PLAN_CRITERIA_MISSING`
 *     （fail-closed，不无锚点开工）；
 *  ② B6 中途发言并入：执行期收到的补充需求写进**当前计划**描述，不重开任务；
 *  ③ B8 日预算耗尽：闸门拒绝 ⇒ 该步落 failed 且 `daily_budget_exhausted`，后续步骤保持
 *     pending（放行后可续跑），主循环立即收尾；
 *  ④ B3 交付回执：终态必发一条回执，demand 额外落盘 `delivery.md`，且原因标注「日预算」。
 *
 * 不联网、不调用真实模型：执行器一律为桩（规划返回 JSON，执行抛闸门错误）。
 */

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError, ErrorCategory, ErrorSeverity } from '@openliri/infra/error';
import { resolveTaskDeliveryPath } from '@openliri/infra/environment';
import { getOrCreateOrchestrator } from '../../src/tasks/LongRunningTaskOrchestrator';
import { taskOrchestrator } from '../../src/tasks/TaskOrchestrator';
import type { Plan } from '../../src/tasks/TaskOrchestrator';
import type { PdcaStatus } from '../../src/tasks/lro/contracts';
import { closePdcaCheckpointStore } from '../../src/tasks/PdcaWorkItemBridge';
import { resetDailyBudgetForTest } from '../../src/query/DailyBudgetManager';
import { appendSupplementToSession } from '../../src/tasks/lro/demandSupplement';
import {
  DAILY_BUDGET_TERMINATION_REASON,
  FAILURE_CATEGORY_LABELS,
  budgetStopped,
} from '../../src/tasks/lro/failureRecovery';
import { setPdcaReceiptSink } from '../../src/tasks/lro/terminalReceipt';

taskOrchestrator.setPlansDir(mkdtempSync(join(tmpdir(), 'plans-b10-')));
const dataDir = mkdtempSync(join(tmpdir(), 'pdca-b10-'));
process.env.LIRI_DATA_DIR = dataDir;

afterAll(() => {
  // 先关 DB（WAL 句柄），否则 Windows 下 rmSync 报 EBUSY
  closePdcaCheckpointStore();
  setPdcaReceiptSink(undefined);
  delete process.env.LIRI_DATA_DIR;
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

/** 仅暴露本文件用到的私有入口（与既有 LRO 测试同模式） */
type SmokeOrchestrator = {
  executor: (params: { userPrompt: string }) => Promise<unknown>;
  _sessionId: string | null;
  _demand: boolean;
  executePlanPhase: (description: string, sessionId: string) => Promise<Plan>;
  executeAllSteps: () => Promise<Plan>;
  _runExecuteDecideLoop: () => Promise<PdcaStatus>;
  getStatus: () => PdcaStatus;
  dispose: () => void;
};

/** 轮询等待异步落定（回执/delivery.md 由终态收尾的异步块发出） */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
}

function makeDemandOrchestrator(
  taskId: string,
  executor: (params: { userPrompt: string }) => Promise<unknown>,
  sessionId: string
): SmokeOrchestrator {
  // 走注册表创建：B6 的并入逻辑按 sessionId 在活跃编排器里查找
  const instance = getOrCreateOrchestrator(
    taskId
  ) as unknown as SmokeOrchestrator;
  instance.executor = executor;
  instance._sessionId = sessionId;
  instance._demand = true;
  return instance;
}

/** demand 计划缺验收标准 ⇒ 重问一次后 fail-closed（不无锚点开工） */
describe('B10 ①：demand 验收前置（B2）', () => {
  it('缺逐条验收标准 ⇒ 重问一次后 PLAN_CRITERIA_MISSING', async () => {
    const prompts: string[] = [];
    const o = makeDemandOrchestrator(
      `b10-criteria-${Date.now()}`,
      async (params) => {
        prompts.push(params.userPrompt);
        // 两次都缺验收标准（纠正也救不回来）⇒ fail-closed
        return JSON.stringify({ steps: ['写计分板'], acceptanceCriteria: [] });
      },
      `sess-b10-criteria-${Date.now()}`
    );

    let thrown: unknown;
    try {
      await o.executePlanPhase('做个贪吃蛇', o._sessionId!);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe('PLAN_CRITERIA_MISSING');
    // 一次计划 + 一次纠正（不是无限重问）
    expect(prompts.length).toBe(2);
    expect(prompts[1]).toContain('验收标准');
    o.dispose();
  });
});

/** 计划 → 补充需求并入 → 预算耗尽停止 → 终态回执 + delivery.md */
describe('B10 ②③④：demand 任务全链路（B6 / B8 / B3）', () => {
  beforeEach(() => {
    // 闸门读取进程级日预算；每个用例从"未超限"开始
    resetDailyBudgetForTest();
  });

  it('补充需求并入当前计划；预算耗尽即停；回执标注原因并落盘交付', async () => {
    const receipts: Array<{ taskId: string; text: string }> = [];
    setPdcaReceiptSink((payload) => receipts.push(payload));

    const taskId = `b10-smoke-${Date.now()}`;
    const sessionId = `sess-b10-smoke-${Date.now()}`;
    let calls = 0;
    const o = makeDemandOrchestrator(
      taskId,
      async () => {
        calls += 1;
        if (calls === 1) {
          // 规划：两步串行（dependsOn 保证第 2 步在第 1 步之后再跑，避免并行批次掩盖"保持 pending"）
          return JSON.stringify({
            steps: ['写核心逻辑', '写计分板'],
            acceptanceCriteria: [
              'grep 在 src 下命中 update',
              'grep 在 src 下命中 score',
            ],
            dependsOn: [[], [0]],
          });
        }
        // 执行：模拟日预算闸门拒绝（与 executorBudgetGuard 抛的是同一个错误码）
        throw new AppError(
          '日预算已耗尽（桩）',
          ErrorCategory.RESOURCE,
          ErrorSeverity.MEDIUM,
          'DAILY_BUDGET_EXCEEDED',
          { taskId }
        );
      },
      sessionId
    );

    // ② 计划阶段：demand ⇒ 验收标准齐备即通过（不等待人工审批由 runFullPdca 的 demand 分支保证）
    await o.executePlanPhase('做个贪吃蛇小游戏', sessionId);
    const plan = o.getStatus().plan!;
    expect(plan.steps.length).toBe(2);
    expect(
      plan.steps.every((s) => (s.acceptanceCriteria ?? '').trim() !== '')
    ).toBe(true);

    // ①（B6）执行中收到补充需求 ⇒ 并入**当前**计划，不重开任务
    expect(appendSupplementToSession(sessionId, '再加一个计分板')).toBe(true);
    expect(o.getStatus().plan!.description).toContain('【补充需求】');

    // ②（B8）第一步撞预算 ⇒ 落 failed + 结构化终止原因；后续步骤保持 pending
    await o.executeAllSteps();
    const afterExec = o.getStatus().plan!;
    expect(afterExec.steps[0].status).toBe('failed');
    expect(afterExec.steps[0].terminationReason).toBe(
      DAILY_BUDGET_TERMINATION_REASON
    );
    expect(afterExec.steps[1].status).toBe('pending');
    expect(budgetStopped(afterExec)).toBe(true);

    // ③ 主循环：立即收尾（不重试、不重规划），终态 failed + 回执
    await o._runExecuteDecideLoop();
    expect(o.getStatus().plan!.status).toBe('failed');
    // 回执与 delivery.md 都在终态收尾的异步块里发出（不阻塞终态）⇒ 等它落定
    await waitFor(
      () => receipts.length > 0 && existsSync(resolveTaskDeliveryPath(taskId))
    );
    expect(receipts.length).toBe(1);
    expect(receipts[0].taskId).toBe(taskId);
    expect(receipts[0].text).toContain(FAILURE_CATEGORY_LABELS.daily_budget);
    // B11：预算停止的下一步建议（放行后续跑），不是"立刻 resume"
    expect(receipts[0].text).toContain('➡️ 下一步：');
    expect(receipts[0].text).toContain('放行/重置日预算');

    // ④（B3）demand 终态额外落盘 delivery.md（与回执同源）
    const deliveryPath = resolveTaskDeliveryPath(taskId);
    expect(existsSync(deliveryPath)).toBe(true);
    expect(readFileSync(deliveryPath, 'utf-8')).toContain(
      FAILURE_CATEGORY_LABELS.daily_budget
    );

    o.dispose();
  });
});
