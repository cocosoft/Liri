/**
 * PDCA 步骤结论判定 + "假成功"防护（2026-11-02）
 *
 * 缺陷实证（会话导出 `chat-export-1793578972845.md`）：
 * 5 个步骤的产出分别是「信息不足，无法确定…」「阻塞，未生成续写内容」
 * 「校验无法完成，结论为阻塞/未通过」……但最终播报 **「✅ PDCA 执行完成：5/5 步」**。
 *
 * 根因：步骤终态只由"LLM 回合是否正常返回文本"决定（`_executeOneStep` 无条件
 * `markStepCompleted`），计划终态只由"所有步骤是否到达终态"决定
 * （`markStep{Failed,Cancelled}` 一律置 `completed`）——**"流程走完"被当成"目标达成"**。
 *
 * 本文件覆盖：
 * ① 结论标记解析（纯函数）；
 * ② 端到端：自述受阻的步骤不得计入完成，计划终态不得为 completed，汇总不得说"执行完成"；
 * ③ 连续受阻熔断：不再为后续步骤白跑模型循环。
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isGoalAchieved,
  parseStepVerdict,
  resolveStepVerdict,
  STEP_VERDICT_DONE,
  STEP_VERDICTS,
} from '../../src/tasks/stepVerdict';
import { PlanDrivenLoop } from '../../src/tasks/PlanDrivenLoop';
import { taskOrchestrator } from '../../src/tasks/TaskOrchestrator';
import type { TAORLoop, TAORLoopDeps } from '@modules/query/TAORLoop';
import type { AIProvider } from '../../src/ai/providers/AIProvider';

describe('parseStepVerdict — 只读结构化标记（不做关键词匹配）', () => {
  it('done / partial / blocked 三档可识别', () => {
    expect(parseStepVerdict('做完了\n[STEP_STATUS: step_done]').verdict).toBe(
      'step_done'
    );
    expect(parseStepVerdict('[STEP_STATUS: step_partial]').verdict).toBe(
      'step_partial'
    );
    expect(parseStepVerdict('[STEP_STATUS: step_blocked]').verdict).toBe(
      'step_blocked'
    );
  });

  it('blocked 携带原因（截断保护）', () => {
    const r = parseStepVerdict(
      '[STEP_STATUS: step_blocked] [STEP_BLOCKED: 缺少目标仓库路径]'
    );
    expect(r.verdict).toBe('step_blocked');
    expect(r.reason).toBe('缺少目标仓库路径');
  });

  it('无标记 ⇒ step_unverified（不臆测为达成）', () => {
    expect(parseStepVerdict('（这里是一段自然语言总结）').verdict).toBe(
      'step_unverified'
    );
    expect(parseStepVerdict('').verdict).toBe('step_unverified');
    expect(parseStepVerdict(undefined).verdict).toBe('step_unverified');
  });

  it('取**最后一个**标记（正文举例不影响结论）', () => {
    const text =
      '格式示例：[STEP_STATUS: step_done]，但本次实际：[STEP_STATUS: step_blocked]';
    expect(parseStepVerdict(text).verdict).toBe('step_blocked');
  });

  it('非法值 ⇒ step_unverified（不猜测）', () => {
    expect(parseStepVerdict('[STEP_STATUS: finished]').verdict).toBe(
      'step_unverified'
    );
  });

  it('容忍大小写与空白', () => {
    expect(parseStepVerdict('[step_status :  STEP_DONE ]').verdict).toBe(
      'step_done'
    );
  });

  it('只有 step_done 算"目标达成"', () => {
    expect(isGoalAchieved(STEP_VERDICT_DONE)).toBe(true);
    for (const v of STEP_VERDICTS) {
      if (v === STEP_VERDICT_DONE) continue;
      expect(isGoalAchieved(v)).toBe(false);
    }
  });
});

describe('resolveStepVerdict — 优先级：暂停 > 非收敛 > 文本标记', () => {
  it('非收敛终止覆盖自述 step_done', () => {
    const r = resolveStepVerdict({
      stepText: '做完了\n[STEP_STATUS: step_done]',
      nonConvergedReason: 'io_loop',
      turnCount: 7,
    });
    expect(r.verdict).toBe('step_blocked');
    expect(r.note).toContain('[NON_CONVERGED:io_loop]');
    expect(r.note).toContain('turns=7');
  });

  it('暂停（awaiting_approval）优先，且不改写为完成', () => {
    const r = resolveStepVerdict({
      stepText: '[STEP_STATUS: step_done]',
      pausedForApproval: true,
    });
    expect(r.verdict).toBe('step_blocked');
    expect(r.note).toContain('等待工具审批');
  });

  it('无终止原因 ⇒ 沿用文本标记与既有说明文案', () => {
    const done = resolveStepVerdict({ stepText: '[STEP_STATUS: step_done]' });
    expect(done.verdict).toBe('step_done');
    expect(done.note).toBe('');
    const blocked = resolveStepVerdict({
      stepText: '[STEP_STATUS: step_blocked] [STEP_BLOCKED: 缺信息]',
    });
    expect(blocked.note).toBe('[STEP_BLOCKED] 缺信息');
  });
});

/** 构造走分解路径的最小 PDL（每个步骤返回固定产出文本） */
function makeLoop(options: {
  sessionId: string;
  subTasks: Array<{ id: string; description: string }>;
  stepText: string;
  /** 每步 runCollect 的终止原因（默认 'stop'；用于非收敛终止回归） */
  terminationReason?: string;
  onRun?: () => void;
}): PlanDrivenLoop {
  const loop = {
    reset: () => {},
    runCollect: async () => {
      options.onRun?.();
      return {
        totalTokens: 5,
        turnCount: 2,
        terminationReason: options.terminationReason ?? 'stop',
      };
    },
    getLastAssistantText: () => options.stepText,
  } as unknown as TAORLoop;

  const provider = {
    id: 'test-provider',
    displayName: 'Test Provider',
    chat: async () => ({
      content: JSON.stringify({
        mainTier: 'complex',
        reasoning: 'r',
        subTasks: options.subTasks,
      }),
      model: 'test-model',
    }),
    listModels: async () => [],
    validateConfig: () => ({ valid: true, errors: [] }),
  } as unknown as AIProvider;

  return new PlanDrivenLoop({
    taorLoop: loop,
    deps: {} as TAORLoopDeps,
    sessionId: options.sessionId,
    enableAutoDecompose: true,
    decomposerProvider: provider,
    fastPathPolicy: { maxSimpleTaskLength: 10, dangerousIntentPatterns: [] },
  });
}

function withIsolatedDataDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'pdl-verdict-'));
  const prev = process.env.LIRI_DATA_DIR;
  process.env.LIRI_DATA_DIR = dataDir;
  taskOrchestrator.setPlansDir(join(dataDir, 'plans'));
  return fn(dataDir).finally(() => {
    if (prev === undefined) delete process.env.LIRI_DATA_DIR;
    else process.env.LIRI_DATA_DIR = prev;
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
}

describe('PDL 目标达成判定（假成功防护）', () => {
  it('自述受阻的步骤不计完成，计划终态为 failed，汇总不出现"执行完成"', async () => {
    await withIsolatedDataDir(async () => {
      const pdl = makeLoop({
        sessionId: 's-verdict-blocked',
        subTasks: [
          { id: 'step-1', description: '步骤A' },
          { id: 'step-2', description: '步骤B' },
        ],
        stepText:
          '信息不足，无法确定要做什么。\n[STEP_STATUS: step_blocked] [STEP_BLOCKED: 缺少明确目标]',
      });

      const result = await pdl.run(
        '这是一个足够长的复杂任务描述，用于强制走分解路径而不是快速路径'
      );

      // ① 两步都执行了，但**都不算完成**
      expect(result.completedSteps).toBe(0);
      expect(result.failedSteps).toBe(2);
      // ② 汇总如实说明未达成，且不得宣称"执行完成"
      expect(result.summary).not.toContain('执行完成');
      expect(result.summary).toContain('0/2 步骤达成');
      // ③ 失败原因可追溯（结论标记落 plan step.error）
      expect(result.stepResults.every((s) => s.state === 'failed')).toBe(true);
      expect(result.stepResults[0]?.error).toContain('[STEP_BLOCKED]');
    });
  });

  it('提供 done 标记的步骤正常计完成', async () => {
    await withIsolatedDataDir(async () => {
      const pdl = makeLoop({
        sessionId: 's-verdict-done',
        subTasks: [
          { id: 'step-1', description: '步骤A' },
          { id: 'step-2', description: '步骤B' },
        ],
        stepText: '已完成本步。\n[STEP_STATUS: step_done]',
      });

      const result = await pdl.run(
        '这是一个足够长的复杂任务描述，用于强制走分解路径而不是快速路径'
      );

      expect(result.completedSteps).toBe(2);
      expect(result.failedSteps).toBe(0);
    });
  });

  it('连续受阻达阈值 ⇒ 熔断剩余步骤（不再为澄清链白跑模型循环）', async () => {
    await withIsolatedDataDir(async () => {
      let runs = 0;
      const pdl = makeLoop({
        sessionId: 's-verdict-cascade',
        subTasks: [
          { id: 'step-1', description: '步骤A' },
          { id: 'step-2', description: '步骤B' },
          { id: 'step-3', description: '步骤C' },
          { id: 'step-4', description: '步骤D' },
        ],
        stepText:
          '需要用户补充信息。\n[STEP_STATUS: step_blocked] [STEP_BLOCKED: 缺信息]',
        onRun: () => {
          runs += 1;
        },
      });

      const result = await pdl.run(
        '这是一个足够长的复杂任务描述，用于强制走分解路径而不是快速路径'
      );

      // 阈值 2：只跑前两步，后续步骤置 cancelled（未执行）
      expect(runs).toBe(2);
      expect(result.failedSteps).toBe(2);
      expect(result.completedSteps).toBe(0);
      // 未执行的 2 步如实出现在汇总里（不粉饰、也不混入"失败"）
      expect(result.summary).toContain('2 步骤因连续受阻提前终止');
    });
  });
});

/**
 * P0-1（2026-11-27，真机 `session_mwz477wj251057474e`）：**终止事实优先于模型自述**。
 *
 * 该轮 step_2 收尾于 `io_loop`、step_3 收尾于 `aborted`，但两者都被记为 completed，
 * 最终播报「✅ 3/3 步完成」——而 step_3 要交付的 `final_response.md` 根本不存在。
 * 根因：PDL 只看 `[STEP_STATUS]` 自述标记，不看终止原因（LRO 经典链早已按此落 failed）。
 */
describe('PDL 非收敛终止（假完成防护·2026-11-27）', () => {
  it('io_loop 的步骤即便自报 step_done 也不得计完成', async () => {
    await withIsolatedDataDir(async () => {
      const pdl = makeLoop({
        sessionId: 's-nonconverged-io-loop',
        subTasks: [
          { id: 'step-1', description: '步骤A' },
          { id: 'step-2', description: '步骤B' },
        ],
        stepText: '已经写完并交付。\n[STEP_STATUS: step_done]',
        terminationReason: 'io_loop',
      });

      const result = await pdl.run(
        '这是一个足够长的复杂任务描述，用于强制走分解路径而不是快速路径'
      );

      expect(result.completedSteps).toBe(0);
      expect(result.failedSteps).toBe(2);
      expect(result.stepResults.every((s) => s.state === 'failed')).toBe(true);
      expect(result.stepResults[0]?.error).toContain('[NON_CONVERGED:io_loop]');
      // 汇总不得宣称"执行完成"
      expect(result.summary).not.toContain('执行完成');
    });
  });

  it('aborted 且无可见正文 ⇒ failed，不再写「完成」占位', async () => {
    await withIsolatedDataDir(async () => {
      const pdl = makeLoop({
        sessionId: 's-nonconverged-aborted',
        // 用两步走分解路径（单步会被快速路径短路，不产生 step 终态）
        subTasks: [
          { id: 'step-1', description: '步骤A' },
          { id: 'step-2', description: '步骤B' },
        ],
        stepText: '',
        terminationReason: 'aborted',
      });

      const result = await pdl.run(
        '这是一个足够长的复杂任务描述，用于强制走分解路径而不是快速路径'
      );

      expect(result.completedSteps).toBe(0);
      expect(result.failedSteps).toBe(2);
      expect(result.stepResults[0]?.error).toContain('[NON_CONVERGED:aborted]');
      // 占位文案不得再宣布成功
      expect(result.stepResults[0]?.output ?? '').not.toContain('完成');
    });
  });
});
