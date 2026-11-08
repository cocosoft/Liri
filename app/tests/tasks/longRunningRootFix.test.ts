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
  isNonConvergedTermination,
  shouldAutoApprovePlan,
} from '../../src/tasks/lro/pureDecisions';
import {
  isAutoReplanEnabled,
  replanMaxRetries,
} from '../../src/tasks/lro/portResolvers';
import { readPdcaCheckpoint } from '../../src/tasks/PdcaWorkItemBridge';

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

describe('非收敛步骤不得记为完成（U-02）', () => {
  it('预算耗尽三类终止原因判为非收敛；completed/undefined 为收敛', () => {
    expect(isNonConvergedTermination('max_turns')).toBe(true);
    expect(isNonConvergedTermination('timeout')).toBe(true);
    expect(isNonConvergedTermination('budget_exhausted')).toBe(true);
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
