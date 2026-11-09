/**
 * GoalEvaluateGate 目标级收敛判定测试（P1-3，对标 Hermes evaluate_after_turn）
 *
 * 覆盖：
 * - 副模型返回 converged=true → 判定收敛
 * - 副模型返回 converged=false → 判定未收敛（阻止假完成）
 * - executor 抛错 → 降级放行（converged=true, evaluated=false，不阻塞主流程）
 * - 输出非 JSON → 解析降级放行
 * - isGoalEvaluateEnabled 默认启用
 */
import { describe, test, expect } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTaskWorkspace } from '@modules/agent';
import {
  GoalEvaluateGate,
  collectArtifactEvidence,
  isGoalEvaluateEnabled,
} from '../../../src/tasks/review/GoalEvaluateGate';
import type { GoalEvaluateContext } from '../../../src/tasks/review/GoalEvaluateGate';
import type { AgentIsolation } from '@modules/agent';

const gate = new GoalEvaluateGate();

function fakeContext(
  executor: GoalEvaluateContext['executor']
): GoalEvaluateContext {
  return {
    isolation: {
      abortController: new AbortController(),
    } as unknown as AgentIsolation,
    executor,
  };
}

const input = {
  goal: '实现 worktree 隔离闭环',
  steps: [
    {
      description: '创建 worktree',
      status: 'completed',
      result: 'done',
      review: '通过',
    },
    {
      description: '回灌 diff',
      status: 'completed',
      result: 'done',
      review: '通过',
    },
  ],
};

describe('GoalEvaluateGate（P1-3）', () => {
  test('副模型判定已收敛 → converged=true', async () => {
    const ctx = fakeContext(async () =>
      JSON.stringify({ converged: true, confidence: 0.9, reason: '目标已实现' })
    );
    const r = await gate.evaluate(input, ctx);
    expect(r.evaluated).toBe(true);
    expect(r.converged).toBe(true);
    expect(r.confidence).toBe(0.9);
    expect(r.reason).toBe('目标已实现');
  });

  test('副模型判定未收敛 → converged=false（阻止假完成）', async () => {
    const ctx = fakeContext(async () =>
      JSON.stringify({
        converged: false,
        confidence: 0.3,
        reason: '步骤完成但输出未实现目标',
      })
    );
    const r = await gate.evaluate(input, ctx);
    expect(r.evaluated).toBe(true);
    expect(r.converged).toBe(false);
  });

  test('executor 抛错 → 跳过结论（converged=undefined, evaluated=false）', async () => {
    const ctx = fakeContext(async () => {
      throw new Error('model unavailable');
    });
    const r = await gate.evaluate(input, ctx);
    expect(r.evaluated).toBe(false);
    expect(r.converged).toBeUndefined(); // L7：失败不误报达成（原 converged=true 语义废弃）
    expect(r.confidence).toBe(0);
  });

  test('输出非 JSON → 解析失败跳过结论（converged=undefined, evaluated=false）', async () => {
    const ctx = fakeContext(async () => '模型只返回了文本，没有 JSON');
    const r = await gate.evaluate(input, ctx);
    expect(r.evaluated).toBe(false);
    expect(r.converged).toBeUndefined(); // L7：解析失败不当作"达成"放行
  });

  test('isGoalEvaluateEnabled 默认启用（未配置环境变量时）', () => {
    expect(isGoalEvaluateEnabled()).toBe(true);
  });

  test('converged=null ⇒ 未决（跳过结论，不阻塞主流程）', async () => {
    const ctx = fakeContext(async () =>
      JSON.stringify({ converged: null, confidence: 0, reason: '证据不足' })
    );
    const r = await gate.evaluate(input, ctx);
    expect(r.evaluated).toBe(false);
    expect(r.converged).toBeUndefined();
    expect(r.reason).toBe('证据不足');
  });

  test('取证闭环：回读产物最终内容 + 标注"历史审查" + 允许 converged=null', async () => {
    const taskId = `pdca_goal_evidence_${Date.now()}`;
    const workspace = resolveTaskWorkspace(taskId);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(
      join(workspace, 'game.js'),
      "const canvas = document.getElementById('gameCanvas');",
      'utf-8'
    );
    let capturedPrompt = '';
    try {
      const ctx: GoalEvaluateContext = {
        isolation: {
          abortController: new AbortController(),
          workspace,
        } as unknown as AgentIsolation,
        executor: async (params) => {
          capturedPrompt = params.userPrompt;
          return JSON.stringify({
            converged: true,
            confidence: 0.9,
            reason: '已修复',
          });
        },
      };
      await gate.evaluate(
        {
          goal: '修复 canvas 引用',
          steps: [
            {
              description: '修复 index.html 引用',
              status: 'completed',
              result: 'done',
              // 陈旧审查文本：第 5 步已修复，但这里仍保留第 4 步的历史结论
              review: "game.js 用 getElementById('game')",
              artifacts: ['game.js'],
            },
          ],
        },
        ctx
      );
      // 最终产物内容必须进入评估输入（而不是只让模型看陈旧审查）
      expect(capturedPrompt).toContain("getElementById('gameCanvas')");
      expect(capturedPrompt).toContain('历史快照');
      expect(capturedPrompt).toContain('converged=null');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('取证边界：长文件截断 / 二进制与目录跳过 / 缺失工作区不阻断', () => {
    const taskId = `pdca_goal_evidence_bounds_${Date.now()}`;
    const workspace = resolveTaskWorkspace(taskId);
    mkdirSync(workspace, { recursive: true });
    try {
      writeFileSync(join(workspace, 'long.txt'), 'x'.repeat(7000), 'utf-8');
      writeFileSync(join(workspace, 'img.png'), 'PNGDATA', 'utf-8');
      mkdirSync(join(workspace, 'subdir'));

      const evidence = collectArtifactEvidence(workspace, [
        'long.txt',
        'img.png',
        'subdir',
        'missing.txt',
      ]);
      expect(evidence).toContain('### long.txt');
      expect(evidence).toContain('已截断');
      expect(evidence).not.toContain('img.png');
      expect(evidence).not.toContain('subdir');
      expect(evidence).not.toContain('missing.txt');

      expect(collectArtifactEvidence(undefined, ['long.txt'])).toBe('');
      expect(collectArtifactEvidence(workspace, [])).toBe('');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
