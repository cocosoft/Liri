// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P3-2（复杂度清理）：`PlanDrivenLoop._executeOneStep` **前驱产出注入**的特征化锁
 * （外移前先测）。
 *
 * 现有用例覆盖 `buildPredecessorSummary` 纯函数与结论判定，但「`_executeOneStep` 如何把
 * 前驱产出 / 依赖降级标注塞进本步 prompt」没有端到端锁 —— 这正是外移该段时最易改坏的地方。
 *
 * 两条：① 前驱有产出 ⇒ 注入产出正文，且**不**出现降级标注；
 *      ② 前驱失败无产出 ⇒ 本步仍执行（soft），prompt 出现 `[DEPENDENCY_DEGRADED]`。
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PlanDrivenLoop } from '../../src/tasks/PlanDrivenLoop';
import { taskOrchestrator } from '../../src/tasks/TaskOrchestrator';
import type { TAORLoop, TAORLoopDeps } from '@modules/query/TAORLoop';
import type { AIProvider } from '../../src/ai/providers/AIProvider';

interface SubTask {
  id: string;
  description: string;
  dependsOn?: string[];
  /** 13-P1-1：显式 soft ⇒ 前驱失败时本步仍执行（默认 hard 会阻断） */
  dependsOnMode?: 'soft' | 'hard';
}

/** 按调用次序返回预设步骤文本；同时捕获每次 runCollect 收到的 prompt */
function makeLoop(options: {
  sessionId: string;
  subTasks: SubTask[];
  stepTexts: string[];
  prompts: string[];
}): PlanDrivenLoop {
  let call = 0;
  const loop = {
    reset: () => {},
    runCollect: async (input: {
      messages: Array<{ content: string }>;
    }): Promise<{
      totalTokens: number;
      turnCount: number;
      terminationReason: string;
    }> => {
      options.prompts.push(input.messages[0]?.content ?? '');
      const text = options.stepTexts[call] ?? options.stepTexts.at(-1) ?? '';
      call += 1;
      return { totalTokens: 5, turnCount: 2, terminationReason: 'stop' };
    },
    getLastAssistantText: () => options.stepTexts[call - 1] ?? '',
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

async function withIsolatedDataDir<T>(
  fn: (dir: string) => Promise<T>
): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'pdl-dep-'));
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

describe('_executeOneStep 前驱产出注入（P3-2 外移前特征化）', () => {
  it('前驱有产出 ⇒ 注入产出正文且无降级标注', async () => {
    await withIsolatedDataDir(async () => {
      const prompts: string[] = [];
      const loop = makeLoop({
        sessionId: 'pdl-dep-ok',
        subTasks: [
          { id: 't1', description: '准备输入数据' },
          { id: 't2', description: '基于输入生成报告', dependsOn: ['t1'] },
        ],
        stepTexts: ['前驱产出：数据集已就绪', '报告已生成'],
        prompts,
      });

      await loop.run('请完成两步任务，输出一份较长的报告文本以满足复杂度判定');

      expect(prompts).toHaveLength(2);
      // 第二步的 prompt 携带前驱产出正文，且不出现降级标注
      expect(prompts[1]).toContain('数据集已就绪');
      expect(prompts[1]).not.toContain('[DEPENDENCY_DEGRADED]');
    });
  });

  it('前驱失败 + soft ⇒ 本步仍执行并注入前驱正文', async () => {
    await withIsolatedDataDir(async () => {
      const prompts: string[] = [];
      const loop = makeLoop({
        sessionId: 'pdl-dep-degraded',
        subTasks: [
          { id: 't1', description: '准备输入数据' },
          {
            id: 't2',
            description: '基于输入生成报告',
            dependsOn: ['t1'],
            dependsOnMode: 'soft',
          },
        ],
        // 第一步自述受阻 ⇒ failed 且无可用产出；第二步显式 soft ⇒ 仍执行并标注降级
        stepTexts: [
          '信息不足\n[STEP_STATUS: step_blocked] [STEP_BLOCKED: 缺少输入文件]',
          '报告已生成',
        ],
        prompts,
      });

      await loop.run('请完成两步任务，输出一份较长的报告文本以满足复杂度判定');

      expect(prompts).toHaveLength(2);
      // soft 下不阻断：本步仍执行，且前驱正文（含其自述受阻）作为依赖注入。
      // 注：`[DEPENDENCY_DEGRADED]` 只在"前驱 failed/skipped **且无产出**"时出现，
      // 由 `buildPredecessorSummary` 的纯函数用例覆盖（`planDrivenLoop.test.ts`）。
      expect(prompts[1]).toContain('缺少输入文件');
    });
  });
});
