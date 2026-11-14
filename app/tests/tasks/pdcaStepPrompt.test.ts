// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// P2-2（2026-11-06）回归锁：PDCA 步骤 prompt 必须带**完整计划源**与**工作区**。
//
// 真机 `session_mw458fpp3ea32a050e`：step1「定位并读取现有执行计划」5 秒即 `step_blocked`
// （自述"没有计划文件/路径，也没有文件工具"）。根因：步骤 prompt 只拿到
// `plan.description`（200 字截断）与步骤描述，没有工作区、没有计划正文。

import { describe, expect, it } from 'bun:test';
import { PlanDrivenLoop } from '../../src/tasks/PlanDrivenLoop';
import type { TAORLoopDeps } from '@modules/query/TAORLoop';
import type { TAORLoop } from '@modules/query/TAORLoop';

type PromptBuilder = {
  _buildStepPrompt: (
    task: { id: string; description: string },
    allTasks: Array<{ id: string; description: string }>,
    index: number
  ) => string;
  planSource: string;
};

function makeLoop(workspacePath?: string): {
  loop: PlanDrivenLoop;
  build: (index: number) => string;
} {
  const loop = new PlanDrivenLoop({
    taorLoop: {} as TAORLoop,
    deps: {} as TAORLoopDeps,
    sessionId: 'sess-p2-2',
    ...(workspacePath ? { workspacePath } : {}),
  });
  const internals = loop as unknown as PromptBuilder;
  // `run()` 才写入 planSource；单测直接注入（等价于 run 的第一行）
  internals.planSource =
    '任务：开发俄罗斯方块\n\n【计划】\nS1 初始化目录\nS2 实现 SRS 旋转\nS3 行消除与计分';
  const tasks = [
    { id: 't1', description: 'S1 初始化目录' },
    { id: 't2', description: 'S2 实现 SRS 旋转' },
  ];
  return {
    loop,
    build: (index: number) =>
      internals._buildStepPrompt(tasks[index], tasks, index),
  };
}

describe('P2-2：步骤 prompt 携带完整计划源', () => {
  it('计划正文（而非 200 字截断的 plan.description）进入 prompt', () => {
    const { loop, build } = makeLoop('E:\\PY\\Documents\\CODES\\PY_APP');
    // 模拟 Plan 实体只有 200 字标题：旧实现只会把这段塞进 prompt
    (loop as unknown as { plan: { description: string } }).plan = {
      description: '任务：开发俄罗斯方块'.slice(0, 200),
    };
    const prompt = build(0);
    expect(prompt).toContain('任务：开发俄罗斯方块');
    expect(prompt).toContain('S2 实现 SRS 旋转');
    expect(prompt).toContain('S3 行消除与计分');
  });

  it('注入 workspacePath ⇒ prompt 明确"文件读写以此目录为准"', () => {
    const { build } = makeLoop('E:\\PY\\Documents\\CODES\\PY_APP');
    expect(build(0)).toContain(
      '工作区（所有文件读写以此目录为准）：E:\\PY\\Documents\\CODES\\PY_APP'
    );
  });

  it('负向：未注入 workspacePath ⇒ 不出现该行（零行为变更）', () => {
    const { build } = makeLoop();
    expect(build(0)).not.toContain('工作区（所有文件读写以此目录为准）');
  });

  it('提示模型直接调用可用工具（对冲"没有文件工具"的自述）', () => {
    const { build } = makeLoop('E:\\work');
    expect(build(0)).toContain('请直接调用当前可用的文件/终端工具');
  });
});
