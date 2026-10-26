// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * LRO-13（2026-10-26）：**续跑幂等**接线守卫（`executeSingleStep` → `executeTools`）。
 *
 * 验收锚点（计划 §LRO-13）：同一会话连续两次「请继续」，第二次**不再重复撞同一堵墙**。
 * 这里用"已入账 + 再次执行同一条命令"复现该场景：
 *   ① 入账（模拟上一步被安全门硬拒）⇒ 台账有 1 条；
 *   ② 本次步骤再发同一条命令（空白不同）⇒ 必须**短路**：结果含 `[BLOCKED_REPLAY]` 与既有
 *      reason，且**不再走到工具解析/执行**（因此不会出现「工具未注册」这类执行期结果）；
 *   ③ 短路不得重复入账。
 *
 * 隔离：计划目录 + `LIRI_DATA_DIR` 均落临时目录（checkpoint 写 app.db）。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LongRunningTaskOrchestrator } from '../../src/tasks/LongRunningTaskOrchestrator';
import { taskOrchestrator } from '../../src/tasks/TaskOrchestrator';
import type { Plan, PlanStep } from '../../src/tasks/TaskOrchestrator';
import { resolveCommandPolicyVersion } from '../../src/tasks/lro/commandPolicyVersion';

taskOrchestrator.setPlansDir(mkdtempSync(join(tmpdir(), 'plans-lro13-')));

const prevDataDir = process.env.LIRI_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), 'pdca-lro13-'));
process.env.LIRI_DATA_DIR = dataDir;

afterAll(async () => {
  const { closePdcaCheckpointStore } =
    await import('../../src/tasks/PdcaWorkItemBridge');
  closePdcaCheckpointStore();
  if (prevDataDir === undefined) {
    delete process.env.LIRI_DATA_DIR;
  } else {
    process.env.LIRI_DATA_DIR = prevDataDir;
  }
  // **不删除**临时数据目录：DB 单例/连接可能仍持有该路径的句柄，删除会让**后续测试文件**
  // 落到已消失的库上（CI macOS 实测 `SQLiteError: disk I/O error`）。临时目录交 OS 清理。
});

/** 待执行的工具调用（模型侧） */
interface FakeToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 步骤执行结果（executeTools 返回元素的最小可断言形态） */
interface ToolCallOutcome {
  toolCallId?: string;
  toolName?: string;
  error?: string;
  failureKind?: string;
}

type OrchestratorUnderTest = {
  planId: string | null;
  isolation: { workspace: string };
  executeSingleStep: (step: PlanStep, plan: Plan) => Promise<void>;
  setTAORLoopFactory: (
    f: (sessionId: string, opts?: unknown) => unknown
  ) => void;
  _blockedCommandLedger: (policyVersion: string) => {
    find: (probe: unknown) => unknown;
    record: (probe: unknown) => void;
  };
  _blockedCommands: Array<{ key: string; command: string; reason: string }>;
};

function makeOrchestrator(taskId: string): OrchestratorUnderTest {
  return new LongRunningTaskOrchestrator(taskId, async () => {
    throw new Error('executor 不应被调用（本用例只跑 TAOR 分支）');
  }) as unknown as OrchestratorUnderTest;
}

/** 假 TAORLoop：把本轮工具调用交给 `deps.executeTools` 真执行，并截获结果 */
function makeFakeLoop(calls: FakeToolCall[], captured: ToolCallOutcome[][]) {
  return {
    config: { sessionId: '' },
    // 真实拦截会触发改道 steering；替身直接吞掉（避免降级到默认 executor 干扰断言）
    injectSteering: () => {},
    runCollect: async (input: {
      deps: {
        executeTools: (
          calls: FakeToolCall[],
          signal: AbortSignal
        ) => Promise<ToolCallOutcome[]>;
      };
    }) => {
      const results = await input.deps.executeTools(
        calls,
        new AbortController().signal
      );
      captured.push(results);
      return { turnCount: 1, totalTokens: 1 };
    },
  };
}

function prepareStep(taskId: string): {
  o: OrchestratorUnderTest;
  plan: Plan;
  step: PlanStep;
} {
  const o = makeOrchestrator(taskId);
  const plan = taskOrchestrator.createPlan(
    'LRO-13 续跑幂等',
    ['步骤A'],
    `session-${taskId}`
  );
  o.planId = plan.id;
  const step = plan.steps[0];
  if (!step) throw new Error('计划缺少步骤');
  return { o, plan, step };
}

describe('LRO-13：同一命令第二次出现 ⇒ 短路不重放', () => {
  it('入账后再次执行同命令（空白不同）⇒ [BLOCKED_REPLAY] + 既有 reason，且不重复入账', async () => {
    const { o, plan, step } = prepareStep('lro13-replay');

    // ① 入账：模拟"上一步被安全门硬拒"（策略版本与步骤执行时同源）
    const ledger = o._blockedCommandLedger(resolveCommandPolicyVersion());
    ledger.record({
      toolName: 'bash',
      args: { command: 'echo   /etc/passwd' },
      cwd: o.isolation.workspace,
      result: {
        success: false,
        error: 'bash: security_gate_blocked',
        metadata: { securityIntercepted: true, reason: 'path_safety' },
      },
    });
    expect(o._blockedCommands).toHaveLength(1);

    // ② 本次步骤再发同一条命令（空白不同 ⇒ 规范化后同键）
    const captured: ToolCallOutcome[][] = [];
    o.setTAORLoopFactory(() =>
      makeFakeLoop(
        [
          {
            id: 'call-1',
            name: 'bash',
            arguments: { command: 'echo /etc/passwd' },
          },
        ],
        captured
      )
    );

    await o.executeSingleStep(step, plan);

    expect(captured).toHaveLength(1);
    const outcome = captured[0]?.[0];
    expect(outcome?.error).toContain('[BLOCKED_REPLAY]');
    expect(outcome?.error).toContain('path_safety');
    expect(outcome?.failureKind).toBe('safety_blocked');
    // 短路发生在工具解析之前 ⇒ 不会出现执行期结果（如「工具未注册」）
    expect(outcome?.error).not.toContain('工具未注册');
    // ③ 短路不得把同一命令再记一次
    expect(o._blockedCommands).toHaveLength(1);

    // ④ 台账必须真的落进 checkpoint —— 否则重启/resume 后无短路依据
    const { readPdcaCheckpoint } =
      await import('../../src/tasks/PdcaWorkItemBridge');
    const ck = await readPdcaCheckpoint('lro13-replay');
    expect(Array.isArray(ck?.blockedCommands)).toBe(true);
    expect((ck?.blockedCommands as unknown[]).length).toBe(1);
  });

  it('不同 cwd ⇒ 不短路（同命令在不同目录结论可能不同）', async () => {
    const { o, plan, step } = prepareStep('lro13-other-cwd');

    const ledger = o._blockedCommandLedger(resolveCommandPolicyVersion());
    ledger.record({
      toolName: 'bash',
      args: { command: 'echo /etc/passwd' },
      cwd: join(o.isolation.workspace, 'another-dir'),
      result: {
        success: false,
        metadata: { securityIntercepted: true, reason: 'path_safety' },
      },
    });

    const probe = {
      toolName: 'bash',
      args: { command: 'echo /etc/passwd' },
    };
    // 正/负对照（纯函数级、跨平台确定）：键含 cwd ⇒ 同 cwd 命中、不同 cwd 不命中
    expect(
      ledger.find({ ...probe, cwd: join(o.isolation.workspace, 'another-dir') })
    ).not.toBeNull();
    expect(
      ledger.find({ ...probe, cwd: o.isolation.workspace })
    ).toBeUndefined();

    const captured: ToolCallOutcome[][] = [];
    o.setTAORLoopFactory(() =>
      makeFakeLoop(
        [
          {
            id: 'call-2',
            name: 'bash',
            arguments: { command: 'echo /etc/passwd' },
          },
        ],
        captured
      )
    );

    await o.executeSingleStep(step, plan);

    // 未短路 ⇒ 命令真的进入执行；**具体拦截文案取决于环境是否注册了 bash 工具**
    // （CI 的 ubuntu runner 未注册 ⇒ 执行期结果是「工具未注册」，故不在此断言 gate 文案）。
    const outcome = captured[0]?.[0];
    expect(outcome?.error).not.toContain('[BLOCKED_REPLAY]');
  });
});
