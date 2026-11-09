// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 长程任务根因守卫（2026-10-17）：
 *   ① `TaskOrchestrator.createPlan` 必须建立 stepId→Plan 索引 —— 此前只有磁盘重载路径
 *      建索引，导致进程内新建计划的 markStep* / review / decide 全部静默 no-op；
 *   ② 前置步骤 failed ⇒ 后继步骤必须 `[DEPENDENCY_BLOCKED]` 取消（不得基于失败输入"成功"）；
 *   ③ `abort()` 必须同步内存 phase 与 plan 终态（此前只写 checkpoint，getStatus() 仍显示执行中）。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LongRunningTaskOrchestrator } from '../../src/tasks/LongRunningTaskOrchestrator';
import { taskOrchestrator } from '../../src/tasks/TaskOrchestrator';
import type { Plan } from '../../src/tasks/TaskOrchestrator';
import {
  resumeFromCheckpoint,
  type ResumeDeps,
} from '../../src/tasks/lro/resumeFromCheckpoint';
import {
  decideTerminalOutcome,
  isNonConvergedTermination,
  shouldAutoApprovePlan,
} from '../../src/tasks/lro/pureDecisions';
import {
  isAutoReplanEnabled,
  replanMaxRetries,
} from '../../src/tasks/lro/portResolvers';
import {
  readPdcaCheckpoint,
  writePdcaCheckpoint,
} from '../../src/tasks/PdcaWorkItemBridge';
import {
  setPdcaReceiptSink,
  emitPdcaInterruptedReceipts,
} from '../../src/tasks/lro/terminalReceipt';
import {
  markResumeFailure,
  markStartFailure,
  writeAbortCheckpoint,
} from '../../src/tasks/lro/checkpointPersist';
import { generateAuditReport } from '../../src/tasks/AuditReport';

taskOrchestrator.setPlansDir(mkdtempSync(join(tmpdir(), 'plans-rootfix-')));

const dataDir = mkdtempSync(join(tmpdir(), 'pdca-rootfix-'));
process.env.LIRI_DATA_DIR = dataDir;

afterAll(async () => {
  const { closePdcaCheckpointStore } =
    await import('../../src/tasks/PdcaWorkItemBridge');
  closePdcaCheckpointStore();
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

type OrchestratorUnderTest = {
  planId: string | null;
  executeAllSteps: () => Promise<Plan>;
  abort: () => Promise<void>;
  getStatus: () => { phase: string };
};

function makeOrchestrator(
  executor: () => Promise<string>
): OrchestratorUnderTest {
  return new LongRunningTaskOrchestrator(
    `rootfix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    executor
  ) as unknown as OrchestratorUnderTest;
}

describe('终态裁决：失败步骤必须阻塞成功（2026-11-09 真机 pdca_mw81e4z5）', () => {
  const failed = [{ id: 'step_5', description: '判定矛盾条件并如实报告' }];

  it('全部终态但有 1 步 failed ⇒ 不算成功，并给出可读原因', () => {
    const r = decideTerminalOutcome({
      allDone: true,
      hasEscalated: false,
      failureReason: null,
      failedSteps: failed,
    });
    expect(r.succeeded).toBe(false);
    expect(r.failureReason).toContain('PDCA_STEP_FAILED');
    expect(r.failureReason).toContain('判定矛盾条件');
  });

  it('多步失败 ⇒ 原因里带失败步数', () => {
    const r = decideTerminalOutcome({
      allDone: true,
      hasEscalated: false,
      failureReason: null,
      failedSteps: [...failed, { id: 'step_6' }],
    });
    expect(r.failureReason).toContain('共 2 步失败');
  });

  it('cancelled（用户 skip）不阻塞成功：调用方只传 failed', () => {
    const r = decideTerminalOutcome({
      allDone: true,
      hasEscalated: false,
      failureReason: null,
      failedSteps: [],
    });
    expect(r.succeeded).toBe(true);
    expect(r.failureReason).toBeNull();
  });

  it('已有更具体原因（如未收敛）⇒ 不被步骤失败覆盖；escalate 不算成功', () => {
    const keep = decideTerminalOutcome({
      allDone: true,
      hasEscalated: false,
      failureReason: 'PDCA_GOAL_NOT_CONVERGED: 目标偏差',
      failedSteps: failed,
    });
    expect(keep.failureReason).toContain('PDCA_GOAL_NOT_CONVERGED');
    expect(keep.succeeded).toBe(false);

    const escalated = decideTerminalOutcome({
      allDone: true,
      hasEscalated: true,
      failureReason: null,
      failedSteps: [],
    });
    expect(escalated.succeeded).toBe(false);
  });

  it('未全部终态 ⇒ 不算成功', () => {
    const r = decideTerminalOutcome({
      allDone: false,
      hasEscalated: false,
      failureReason: null,
      failedSteps: [],
    });
    expect(r.succeeded).toBe(false);
    expect(r.failureReason).toBeNull();
  });
});

describe('非收敛步骤不得记为完成（U-02）', () => {
  it('预算耗尽三类终止原因判为非收敛；completed/undefined 为收敛', () => {
    expect(isNonConvergedTermination('max_turns')).toBe(true);
    expect(isNonConvergedTermination('timeout')).toBe(true);
    expect(isNonConvergedTermination('budget_exhausted')).toBe(true);
    // 2026-11-08（真机 `pdca_mw7sfwyf`）：TAORLoop 因 no_tool_call 死循环中止 ⇒ 中止≠完成
    expect(isNonConvergedTermination('aborted')).toBe(true);
    // 2026-11-09（真机 `pdca_mw8vmiy9`）：模型调用失败（DNS 中断）以 error 收尾 ⇒ 异常≠完成
    expect(isNonConvergedTermination('error')).toBe(true);
    expect(isNonConvergedTermination('completed')).toBe(false);
    expect(isNonConvergedTermination(undefined)).toBe(false);
  });

  it('markStepFailed 保留 terminationReason + 片段证据（resume 扩容判定输入）', () => {
    const plan = taskOrchestrator.createPlan(
      '非收敛步骤',
      ['步骤A'],
      'session-nonconverged'
    );
    const step = plan.steps[0];
    taskOrchestrator.markStepRunning(step.id);

    const failed = taskOrchestrator.markStepFailed(step.id, '未在预算内收敛', {
      terminationReason: 'max_turns',
      partialOutput: '部分产出',
    });

    expect(failed?.status).toBe('failed');
    expect(failed?.terminationReason).toBe('max_turns');
    expect(failed?.partialOutput).toBe('部分产出');
  });
});

describe('目标未收敛自动 replan 开关（U-02）', () => {
  it('默认关闭：仅 PDCA_AUTO_REPLAN=true 启用', () => {
    delete process.env.PDCA_AUTO_REPLAN;
    expect(isAutoReplanEnabled()).toBe(false);
    process.env.PDCA_AUTO_REPLAN = '1';
    expect(isAutoReplanEnabled()).toBe(false);
    process.env.PDCA_AUTO_REPLAN = 'true';
    expect(isAutoReplanEnabled()).toBe(true);
    delete process.env.PDCA_AUTO_REPLAN;
  });

  it('replan 次数上限：缺失/非法回退 3，正数生效', () => {
    delete process.env.PDCA_REPLAN_MAX_RETRIES;
    expect(replanMaxRetries()).toBe(3);
    process.env.PDCA_REPLAN_MAX_RETRIES = 'abc';
    expect(replanMaxRetries()).toBe(3);
    process.env.PDCA_REPLAN_MAX_RETRIES = '5';
    expect(replanMaxRetries()).toBe(5);
    delete process.env.PDCA_REPLAN_MAX_RETRIES;
  });

  it('计划审批：仅"要求审批 + 无人值守"时自动通过，其余保持人工', () => {
    expect(shouldAutoApprovePlan(true, true)).toBe(true);
    expect(shouldAutoApprovePlan(true, false)).toBe(false);
    expect(shouldAutoApprovePlan(false, true)).toBe(false);
    expect(shouldAutoApprovePlan(false, false)).toBe(false);
  });
});

describe('createPlan 步骤索引（P0 根因）', () => {
  it('新建计划即可被 markStepRunning / markStepCompleted / markStepCancelled 命中', () => {
    const plan = taskOrchestrator.createPlan(
      '索引守卫',
      ['步骤A', '步骤B'],
      'session-rootfix'
    );
    const [a, b] = plan.steps;

    expect(taskOrchestrator.markStepRunning(a.id)?.status).toBe('running');
    expect(taskOrchestrator.markStepCompleted(a.id, '证据')?.status).toBe(
      'completed'
    );
    expect(a.result).toBe('证据');
    expect(taskOrchestrator.markStepCancelled(b.id, '用户中止')?.status).toBe(
      'cancelled'
    );
    expect(b.error).toBe('用户中止');
  });
});

describe('abortPlan：用户主动终止 ≠ 失败（2026-11-08 真机 plan_mw7m5cxi_7fc7）', () => {
  it('活跃步骤落 cancelled、计划落 aborted（不再被记成 failed）', async () => {
    const plan = taskOrchestrator.createPlan(
      '终止守卫',
      ['步骤A'],
      'session-abort'
    );
    const step = plan.steps[0]!;
    taskOrchestrator.markStepRunning(step.id);

    expect(await taskOrchestrator.abortPlan(plan.id)).toBe(true);
    expect(step.status).toBe('cancelled');
    expect(plan.status).toBe('aborted');
    expect(plan.completedAt).toBeDefined();

    // 不存在的计划 ⇒ false（HTTP 侧据此回 404）
    expect(await taskOrchestrator.abortPlan('plan_missing_xyz')).toBe(false);
  });
});

describe('依赖失败阻断', () => {
  it('前置步骤 failed ⇒ 后继 cancelled 且标注 [DEPENDENCY_BLOCKED]', async () => {
    const o = makeOrchestrator(async () => {
      throw new Error('dep-step-failed');
    });
    const plan = taskOrchestrator.createPlan(
      '依赖阻断',
      ['前置步骤', '后继步骤'],
      'session-dep',
      undefined,
      undefined,
      undefined,
      [[], [0]]
    );
    o.planId = plan.id;
    plan.steps[0].maxRetries = 0;

    await o.executeAllSteps();

    expect(plan.steps[0].status).toBe('failed');
    expect(plan.steps[1].status).toBe('cancelled');
    expect(plan.steps[1].error).toContain('[DEPENDENCY_BLOCKED]');
  });
});

describe('abort 终态一致性', () => {
  it('abort() 后内存 phase=abort 且 plan.status=aborted', async () => {
    const o = makeOrchestrator(async () => 'ok');
    const plan = taskOrchestrator.createPlan(
      '中止终态',
      ['步骤A'],
      'session-abort'
    );
    o.planId = plan.id;

    await o.abort();

    expect(o.getStatus().phase).toBe('abort');
    expect(plan.status).toBe('aborted');
  });
});

/** resume 桩依赖：记录回填的会话/用量/扩容字段，执行循环直接返回标记 */
function makeResumeDeps(taskId: string): {
  deps: ResumeDeps;
  state: {
    created: string[];
    sessionId: string | null;
    totalTokens: number;
    turnsExtensions: number;
    startedAt: number;
    loopRan: boolean;
    /** LRO-13：resume 恢复的阻塞命令台账（条数即可） */
    blockedCount: number;
    /** P2：resume 重放策略快照的入参（缺省快照也要被调用 ⇒ 由实现侧降级 ask） */
    replayedSessionId: string | null;
    replayedSnapshot: unknown;
  };
} {
  const state = {
    created: [] as string[],
    sessionId: null as string | null,
    totalTokens: 0,
    turnsExtensions: 0,
    startedAt: 0,
    loopRan: false,
    blockedCount: -1,
    replayedSessionId: null as string | null,
    replayedSnapshot: undefined as unknown,
  };
  const deps: ResumeDeps = {
    taskId,
    executePlanPhase: async (description, sessionId) => {
      return taskOrchestrator.createPlan(
        description,
        ['重规划步骤'],
        sessionId
      );
    },
    runExecuteDecideLoop: async () => {
      state.loopRan = true;
      return 'ran';
    },
    getStatus: () => ({ phase: 'execute' }),
    setPhase: async () => {},
    recordLifecycle: () => {},
    persistCheckpoint: async () => {},
    resolveWorkspaceId: async () => undefined,
    createPlan: (description, steps, sessionId) => {
      state.created.push(description);
      return taskOrchestrator.createPlan(description, steps, sessionId);
    },
    getLastEscalations: () => [],
    setLastEscalations: () => {},
    getTurnsExtensions: () => state.turnsExtensions,
    setTurnsExtensions: (value) => {
      state.turnsExtensions = value;
    },
    getStepTurnsMultiplier: () => 1,
    setStepTurnsMultiplier: () => {},
    setPlanId: () => {},
    setSessionId: (value) => {
      state.sessionId = value;
    },
    setTotalTokensTracked: (value) => {
      state.totalTokens = value;
    },
    setStartedAt: (value) => {
      state.startedAt = value;
    },
    setBlockedCommands: (value) => {
      state.blockedCount = value.length;
    },
    // P2（2026-11-04）：策略快照重放（记录入参，供"缺失快照仍被调用"的用例断言）
    replayPolicySnapshot: (sessionId, raw) => {
      state.replayedSessionId = sessionId;
      state.replayedSnapshot = raw;
    },
  };
  return { deps, state };
}

describe('resume 可达性与字段回填', () => {
  it('启动扫描的 status=abort + 非终态 phase ⇒ 允许续跑（M2 可达）', async () => {
    const { deps, state } = makeResumeDeps('interrupted-1');
    const result = await resumeFromCheckpoint(
      {
        taskId: 'interrupted-1',
        sessionId: 'sess-interrupted',
        phase: 'execute',
        status: 'abort',
        description: '崩溃遗留任务',
        steps: [{ id: 's1', description: '步骤1', status: 'pending' }],
      },
      deps
    );

    expect(result).toBe('ran');
    expect(state.loopRan).toBe(true);
    expect(state.created).toEqual(['崩溃遗留任务']);
    expect(state.sessionId).toBe('sess-interrupted');
    // P2：无论有无快照都要触发重放（缺快照由实现侧降级 ask，而不是跳过）
    expect(state.replayedSessionId).toBe('sess-interrupted');
    expect(state.replayedSnapshot).toBeUndefined();
  });

  it('带策略快照的 checkpoint ⇒ 快照原样交给重放', async () => {
    const { deps, state } = makeResumeDeps('with-snapshot');
    const snapshot = {
      version: 1,
      capturedAt: 1700000000000,
      permissionMode: 'strict',
      approvalMode: 'ask',
      workspaceRoots: ['D:\\work'],
      commandPolicyVersion: 'abc123',
    };
    const result = await resumeFromCheckpoint(
      {
        taskId: 'with-snapshot',
        sessionId: 'sess-snap',
        phase: 'execute',
        description: '带快照任务',
        steps: [{ id: 's1', description: '步骤1', status: 'pending' }],
        policySnapshot: snapshot,
      },
      deps
    );

    expect(result).toBe('ran');
    expect(state.replayedSessionId).toBe('sess-snap');
    expect(state.replayedSnapshot).toEqual(snapshot);
  });

  it('用户中止（phase=abort）仍拒绝恢复', async () => {
    const { deps } = makeResumeDeps('aborted-1');
    await expect(
      resumeFromCheckpoint(
        {
          taskId: 'aborted-1',
          phase: 'abort',
          status: 'abort',
          steps: [{ id: 's1', description: '步骤1', status: 'pending' }],
        },
        deps
      )
    ).rejects.toThrow(/已处于终态/);
  });

  it('半自动 replan 分支回填 sessionId / token / 扩容计数（原提前 return 漏填）', async () => {
    const { deps, state } = makeResumeDeps('replan-1');
    const result = await resumeFromCheckpoint(
      {
        taskId: 'replan-1',
        sessionId: 'sess-replan',
        phase: 'execute',
        status: 'failed',
        replanPending: true,
        replanFailCount: 1,
        description: 'replan 任务',
        totalTokens: 42,
        turnsExtensions: 2,
        startedAt: 1700000000000,
        lastEscalations: [
          { stepId: 's1', stepDescription: '步骤1', defects: ['x'] },
        ],
      },
      deps
    );

    expect(result).toBe('ran');
    expect(state.loopRan).toBe(true);
    expect(state.sessionId).toBe('sess-replan');
    expect(state.totalTokens).toBe(42);
    expect(state.turnsExtensions).toBe(2);
    expect(state.startedAt).toBe(1700000000000);
  });

  it('LRO-13：resume 恢复阻塞命令台账（残缺项被丢弃），续跑才有短路依据', async () => {
    const { deps, state } = makeResumeDeps('blocked-1');
    await resumeFromCheckpoint(
      {
        taskId: 'blocked-1',
        sessionId: 'sess-blocked',
        phase: 'execute',
        status: 'failed',
        replanPending: true,
        replanFailCount: 0,
        description: '撞墙任务',
        steps: [{ id: 's1', description: '步骤1', status: 'pending' }],
        blockedCommands: [
          {
            key: 'k1',
            toolName: 'bash',
            command: 'echo /etc/passwd',
            cwd: '/work',
            policyVersion: 'v1',
            reason: 'path_safety',
            recordedAt: 1,
          },
          // 残缺项（缺 reason）⇒ 必须被丢弃，不得进短路依据
          { key: 'k2', toolName: 'bash', command: 'rm -rf /' },
        ],
      },
      deps
    );

    expect(state.blockedCount).toBe(1);
  });

  it('LRO-13：checkpoint 无台账（旧存档）⇒ 恢复为空，不影响续跑', async () => {
    const { deps, state } = makeResumeDeps('blocked-none');
    await resumeFromCheckpoint(
      {
        taskId: 'blocked-none',
        sessionId: 'sess-none',
        phase: 'execute',
        status: 'abort',
        description: '旧存档',
        steps: [{ id: 's1', description: '步骤1', status: 'pending' }],
      },
      deps
    );

    expect(state.blockedCount).toBe(0);
    expect(state.loopRan).toBe(true);
  });
});

describe('escalate 收尾的 phase 投影（2026-11-08 真机 pdca_mw79lfjh）', () => {
  /** 造一个"全部步骤终态 + 某步 escalate"的计划（直接驱动终态裁决段） */
  function makeEscalatedOrchestrator(taskId: string): {
    run: () => Promise<{ phase: string }>;
  } {
    const o = new LongRunningTaskOrchestrator(taskId, async () => 'not-json');
    const plan = taskOrchestrator.createPlan(
      'escalate 终态投影',
      ['步骤A', '步骤B'],
      'session-escalate-phase'
    );
    for (const s of plan.steps) {
      s.status = 'failed';
      s.decision = 'escalate';
    }
    (o as unknown as { planId: string | null }).planId = plan.id;
    return {
      run: () =>
        (
          o as unknown as {
            _runExecuteDecideLoop: () => Promise<{ phase: string }>;
          }
        )._runExecuteDecideLoop(),
    };
  }

  it('replan 预算用尽（replanPending=false）⇒ phase=failed，不再显示"执行中"', async () => {
    process.env.PDCA_GOAL_EVALUATE = 'false';
    process.env.PDCA_REPLAN_MAX_RETRIES = '1';
    const taskId = `escalate-exhausted-${Date.now()}`;
    try {
      const status = await makeEscalatedOrchestrator(taskId).run();
      expect(status.phase).toBe('failed');
      const ck = await readPdcaCheckpoint(taskId);
      expect(ck?.['phase']).toBe('failed');
      expect(ck?.['replanPending']).toBe(false);
      expect(ck?.['replanFailCount']).toBe(1);
    } finally {
      delete process.env.PDCA_GOAL_EVALUATE;
      delete process.env.PDCA_REPLAN_MAX_RETRIES;
    }
  });

  it('仍有 replan 预算 ⇒ 保持 phase=execute（可续跑语义不变）', async () => {
    process.env.PDCA_GOAL_EVALUATE = 'false';
    process.env.PDCA_REPLAN_MAX_RETRIES = '3';
    const taskId = `escalate-pending-${Date.now()}`;
    try {
      const status = await makeEscalatedOrchestrator(taskId).run();
      expect(status.phase).toBe('execute');
      const ck = await readPdcaCheckpoint(taskId);
      expect(ck?.['phase']).toBe('execute');
      expect(ck?.['replanPending']).toBe(true);
      expect(ck?.['replanFailCount']).toBe(1);
    } finally {
      delete process.env.PDCA_GOAL_EVALUATE;
      delete process.env.PDCA_REPLAN_MAX_RETRIES;
    }
  });
});

describe('启动期失败的收口（2026-11-08 真机 pdca_mw7gf70g，CLI /goal start 路径）', () => {
  it('started/plan ⇒ 落 failed（replanPending=false）并发 ⚠️ 回执', async () => {
    const taskId = `start-fail-${Date.now()}`;
    await writePdcaCheckpoint(taskId, {
      taskId,
      sessionId: 'sess-start-fail',
      phase: 'plan',
      status: 'started',
    });
    const receipts: Array<{ taskId: string; sessionId: string; text: string }> =
      [];
    setPdcaReceiptSink((p) => receipts.push(p));
    let marked = false;
    try {
      marked = await markStartFailure({
        taskId,
        error: new Error('Planner 输出无法解析为有效计划（已重问一次）'),
      });
    } finally {
      setPdcaReceiptSink(undefined);
    }

    expect(marked).toBe(true);
    const ck = await readPdcaCheckpoint(taskId);
    expect(ck?.['phase']).toBe('failed');
    expect(ck?.['status']).toBe('failed');
    // 无计划 ⇒ 不可 replan（与续跑失败不同）
    expect(ck?.['replanPending']).toBe(false);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.sessionId).toBe('sess-start-fail');
    expect(receipts[0]?.text).toContain('启动失败');
    expect(receipts[0]?.text).toContain('可重新发起');
  });

  it('已终态 ⇒ 不覆盖、返回 false、不发回执', async () => {
    const taskId = `start-fail-terminal-${Date.now()}`;
    await writePdcaCheckpoint(taskId, {
      taskId,
      sessionId: 'sess-start-terminal',
      phase: 'abort',
      status: 'abort',
    });
    const receipts: Array<{ taskId: string; sessionId: string; text: string }> =
      [];
    setPdcaReceiptSink((p) => receipts.push(p));
    let marked = true;
    try {
      marked = await markStartFailure({ taskId, error: new Error('x') });
    } finally {
      setPdcaReceiptSink(undefined);
    }

    expect(marked).toBe(false);
    const ck = await readPdcaCheckpoint(taskId);
    expect(ck?.['phase']).toBe('abort');
    expect(ck?.['status']).toBe('abort');
    expect(receipts).toHaveLength(0);
  });
});

describe('续跑失败的收口（2026-11-08 真机 pdca_mw7bjwo8）', () => {
  it('真跑阶段抛错 ⇒ 检查点落 failed+replanPending，并发一条 ⚠️ 回执', async () => {
    const taskId = `resume-fail-${Date.now()}`;
    await writePdcaCheckpoint(taskId, {
      taskId,
      sessionId: 'sess-resume-fail',
      phase: 'plan',
      status: 'started',
      replanPending: true,
      replanFailCount: 2,
    });
    const receipts: Array<{ taskId: string; sessionId: string; text: string }> =
      [];
    const memoryPhases: string[] = [];
    setPdcaReceiptSink((p) => receipts.push(p));
    try {
      await markResumeFailure({
        taskId,
        error: new Error('Planner 输出无法解析为有效计划（已重问一次）'),
        onPhase: (p) => memoryPhases.push(p),
      });
    } finally {
      setPdcaReceiptSink(undefined);
    }

    const ck = await readPdcaCheckpoint(taskId);
    expect(ck?.['phase']).toBe('failed');
    expect(ck?.['status']).toBe('failed');
    // 保留可重试：下一轮 /resume 仍会放行（failed + replanPending）
    expect(ck?.['replanPending']).toBe(true);
    expect(ck?.['replanFailCount']).toBe(2);
    expect(memoryPhases).toEqual(['failed']);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.sessionId).toBe('sess-resume-fail');
    expect(receipts[0]?.text).toContain('续跑失败');
    expect(receipts[0]?.text).toContain('可重试');
  });

  it('包装层：真跑阶段失败 ⇒ 收口后仍上抛（调用方日志不丢）', async () => {
    const { deps } = makeResumeDeps('replan-fail');
    const memoryPhases: string[] = [];
    deps.setMemoryPhase = (p) => memoryPhases.push(p);
    deps.executePlanPhase = async () => {
      throw new Error('PLAN_PARSE_FAILED');
    };

    await expect(
      resumeFromCheckpoint(
        {
          taskId: 'replan-fail',
          sessionId: 'sess-replan-fail',
          phase: 'execute',
          status: 'failed',
          replanPending: true,
          replanFailCount: 1,
          description: 'replan 失败任务',
          steps: [{ id: 's1', description: '步骤1', status: 'pending' }],
        },
        deps
      )
    ).rejects.toThrow('PLAN_PARSE_FAILED');

    expect(memoryPhases).toEqual(['failed']);
    const ck = await readPdcaCheckpoint('replan-fail');
    expect(ck?.['phase']).toBe('failed');
    expect(ck?.['status']).toBe('failed');
    expect(ck?.['replanPending']).toBe(true);
  });

  it('终态拒绝不算「续跑失败」⇒ 不落失败检查点、不打内存 phase', async () => {
    const { deps } = makeResumeDeps('terminal-refuse');
    const memoryPhases: string[] = [];
    deps.setMemoryPhase = (p) => memoryPhases.push(p);

    await expect(
      resumeFromCheckpoint(
        {
          taskId: 'terminal-refuse',
          phase: 'completed',
          status: 'completed',
          steps: [{ id: 's1', description: '步骤1', status: 'completed' }],
        },
        deps
      )
    ).rejects.toThrow(/已处于终态/);

    expect(memoryPhases).toEqual([]);
    expect(await readPdcaCheckpoint('terminal-refuse')).toBeNull();
  });
});

describe('崩溃遗留可续跑（2026-11-08 真机 pdca_mw7d3dq3）', () => {
  it('启动扫描标记 abortedBy=startup_scan ⇒ phase=abort 仍允许续跑', async () => {
    const { deps, state } = makeResumeDeps('crash-leftover');
    const result = await resumeFromCheckpoint(
      {
        taskId: 'crash-leftover',
        sessionId: 'sess-crash',
        phase: 'abort',
        status: 'abort',
        abortedBy: 'startup_scan',
        description: '崩溃遗留任务',
        steps: [{ id: 's1', description: '步骤1', status: 'pending' }],
      },
      deps
    );

    expect(result).toBe('ran');
    expect(state.loopRan).toBe(true);
  });

  it('用户主动中止（无标记）⇒ 仍拒绝续跑', async () => {
    const { deps } = makeResumeDeps('user-aborted');
    await expect(
      resumeFromCheckpoint(
        {
          taskId: 'user-aborted',
          phase: 'abort',
          status: 'abort',
          steps: [{ id: 's1', description: '步骤1', status: 'pending' }],
        },
        deps
      )
    ).rejects.toThrow(/已处于终态/);
  });

  it('崩溃标记在用户中止后被覆盖 ⇒ 不再可续跑（真机 pdca_mw7dmlhw 复盘）', async () => {
    const taskId = `crash-then-abort-${Date.now()}`;
    await writePdcaCheckpoint(taskId, {
      taskId,
      sessionId: 'sess-crash-abort',
      phase: 'abort',
      status: 'abort',
      abortedBy: 'startup_scan',
      steps: [{ id: 's1', description: '步骤1', status: 'pending' }],
    });

    await writeAbortCheckpoint(taskId);

    const ck = await readPdcaCheckpoint(taskId);
    expect(ck?.['abortedBy']).toBe('user_abort');
    const { deps } = makeResumeDeps(taskId);
    await expect(resumeFromCheckpoint(ck!, deps)).rejects.toThrow(/已处于终态/);
  });

  it('中断回执：有步骤快照 ⇒ 告知可续跑；无快照 ⇒ 如实说明不可续跑', () => {
    const receipts: Array<{ taskId: string; sessionId: string; text: string }> =
      [];
    setPdcaReceiptSink((p) => receipts.push(p));
    try {
      emitPdcaInterruptedReceipts([
        {
          taskId: 'crash-1',
          sessionId: 'sess-1',
          steps: [{ id: 's1' }, { id: 's2' }],
        },
        { taskId: 'crash-2', sessionId: 'sess-2', steps: [] },
      ]);
    } finally {
      setPdcaReceiptSink(undefined);
    }

    expect(receipts).toHaveLength(2);
    expect(receipts[0]?.text).toContain('因进程重启被中断');
    expect(receipts[0]?.text).toContain('2 步计划已保留');
    expect(receipts[0]?.text).toContain('续跑');
    expect(receipts[1]?.text).toContain('无法自动续跑');
  });
});

describe('审计摘要不得把「未终态步骤」算作完成（2026-11-08 真机 pdca_mw7e6fvy）', () => {
  const step = (id: string, status: string) => ({
    id,
    description: id,
    status,
    retryCount: 0,
    durationMs: 0,
  });

  it('2 completed + 1 pending（中止 / 未跑完）⇒ 未完全完成', () => {
    const r = generateAuditReport({
      taskId: 't1',
      planId: 'p1',
      steps: [
        step('a', 'completed'),
        step('b', 'completed'),
        step('c', 'pending'),
      ],
    });
    expect(r.summary.startsWith('任务 未完全完成')).toBe(true);
  });

  it('全部 completed ⇒ 任务 完成', () => {
    const r = generateAuditReport({
      taskId: 't2',
      planId: 'p2',
      steps: [step('a', 'completed'), step('b', 'completed')],
    });
    expect(r.summary.startsWith('任务 完成')).toBe(true);
  });

  it('有 failed ⇒ 仍为未完全完成（既有语义不变）', () => {
    const r = generateAuditReport({
      taskId: 't3',
      planId: 'p3',
      steps: [step('a', 'completed'), step('b', 'failed')],
    });
    expect(r.summary.startsWith('任务 未完全完成')).toBe(true);
  });

  // 2026-11-08（真机 pdca_mw7f7h2g）：目标未收敛 ⇒ 步骤 2/2 全通过，但任务已 failed
  it('任务级失败（target taskFailed）⇒ 全部步骤 completed 也写未完全完成', () => {
    const r = generateAuditReport({
      taskId: 't4',
      planId: 'p4',
      taskFailed: true,
      steps: [step('a', 'completed'), step('b', 'completed')],
    });
    expect(r.summary.startsWith('任务 未完全完成')).toBe(true);
  });
});
