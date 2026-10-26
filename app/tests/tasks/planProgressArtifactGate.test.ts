// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * LRO-12（2026-10-26）：**进度与产出绑定**。
 *
 * 失败窗口的语义错位：模型把步骤/待办逐个标成完成，进度条就报 100%（"绿了"），
 * 但磁盘上没有任何产物 —— 用户看到"完成"却拿不到东西。设计口径：
 *
 * 1. 进度只由**产物存在性**推进：已采集台账（`artifacts` 为数组）的完成步，
 *    **空台账不计数**；未采集台账（`undefined`，如 PlanDrivenLoop 快速路径）沿旧口径。
 * 2. `percent` 与 `completed` **解耦**：`completed` 是事实（步骤状态），`percent` 是
 *    产物支撑的进度。
 * 3. `artifactGated` 为真 ⇒ 供 UI/日志解释"为什么步骤完成了但进度不涨"。
 * 4. 台账随 checkpoint 持久化 / resume 回填 —— 否则重启后进度掉回 0。
 *
 * 验收锚点（计划 §LRO-12）：**人为让 0 产物但步骤全 done ⇒ 进度不得报完成**。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TaskOrchestrator } from '../../src/tasks/TaskOrchestrator.js';

let dir: string;
let orchestrator: TaskOrchestrator;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pyapp-lro12-'));
  orchestrator = new TaskOrchestrator();
  orchestrator.setPlansDir(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 建一个含 n 步的计划，全部标 running（便于后续 markStepCompleted） */
function planWithSteps(n: number) {
  const plan = orchestrator.createPlan(
    'LRO-12 进度绑定产出',
    Array.from({ length: n }, (_, i) => `步骤${i + 1}`),
    'sess-lro12'
  );
  for (const step of plan.steps) orchestrator.markStepRunning(step.id);
  return plan;
}

/** 取计划（缺失即测试自身写错，直接抛） */
function planOf(planId: string) {
  const plan = orchestrator.getPlan(planId);
  if (!plan) throw new Error(`计划不存在: ${planId}`);
  return plan;
}

function complete(planId: string, idx: number, artifacts?: string[]): void {
  const step = planOf(planId).steps[idx];
  if (!step) throw new Error(`步骤不存在: ${idx}`);
  orchestrator.markStepCompleted(
    step.id,
    `步骤${idx + 1} 结果`,
    artifacts === undefined ? undefined : { artifacts }
  );
}

/** 取进度（缺失即测试自身写错，直接抛） */
function progressOf(planId: string) {
  const p = orchestrator.getPlanProgress(planId);
  if (!p) throw new Error(`进度不存在: ${planId}`);
  return p;
}

describe('LRO-12：0 产物 ⇒ 进度不得报完成', () => {
  it('三步全完成但台账为空 ⇒ completed=3 而 percent=0，且 artifactGated', () => {
    const plan = planWithSteps(3);
    complete(plan.id, 0, []);
    complete(plan.id, 1, []);
    complete(plan.id, 2, []);

    const p = progressOf(plan.id);
    expect(p.completed).toBe(3);
    expect(p.total).toBe(3);
    // 关键断言：不得因为"步骤全 done"就报 100%
    expect(p.percent).toBe(0);
    expect(p.artifacts).toBe(0);
    expect(p.artifactGated).toBe(true);
  });

  it('有产物 ⇒ 按"有产物支撑的完成步"推进（1/3 ⇒ 33%）', () => {
    const plan = planWithSteps(3);
    complete(plan.id, 0, ['a.txt']);
    complete(plan.id, 1, []);
    complete(plan.id, 2, []);

    const p = progressOf(plan.id);
    expect(p.percent).toBe(33);
    expect(p.artifacts).toBe(1);
    // 另外两步是"空台账"⇒ 有完成步未计入 ⇒ 仍标记被门压住（如实反映"这 2 步没产出"）
    expect(p.artifactGated).toBe(true);
  });

  it('每步都有产物 ⇒ 100%（正常的成功路径不被误伤）', () => {
    const plan = planWithSteps(2);
    complete(plan.id, 0, ['out/a.txt']);
    complete(plan.id, 1, ['out/b.txt']);

    const p = progressOf(plan.id);
    expect(p.percent).toBe(100);
    expect(p.artifacts).toBe(2);
    expect(p.artifactGated).toBe(false);
  });

  it('未采集台账（undefined）沿旧口径 —— 不把"没采集"误判成"没产物"', () => {
    const plan = planWithSteps(2);
    complete(plan.id, 0);
    complete(plan.id, 1);

    const p = progressOf(plan.id);
    expect(p.percent).toBe(100);
    expect(p.artifacts).toBe(0);
    // 未采集 ⇒ 不算"被门压住"（否则 PlanDrivenLoop 快速路径会全员误报）
    expect(p.artifactGated).toBe(false);
  });

  it('台账去重：同一步重复登记同一路径只计一次', () => {
    const plan = planWithSteps(1);
    complete(plan.id, 0, ['same.txt', 'same.txt']);

    expect(planOf(plan.id).steps[0]?.artifacts).toEqual(['same.txt']);
    expect(progressOf(plan.id).artifacts).toBe(1);
  });
});

describe('LRO-12：台账持久化（重启后进度不掉回 0）', () => {
  it('PlanStep.artifacts 随计划落盘，重新加载后仍在', async () => {
    const plan = planWithSteps(1);
    complete(plan.id, 0, ['keep.txt']);

    const raw = JSON.parse(
      readFileSync(join(dir, `plan_${plan.id}.json`), 'utf-8')
    ) as { steps: Array<{ artifacts?: string[] }> };
    expect(raw.steps[0]?.artifacts).toEqual(['keep.txt']);

    // 新实例重新加载 ⇒ 进度仍按产物判定（不因重启回到 0）
    const reloaded = new TaskOrchestrator();
    reloaded.setPlansDir(dir);
    await reloaded.initialize();
    expect(reloaded.getPlan(plan.id)?.steps[0]?.artifacts).toEqual([
      'keep.txt',
    ]);
    expect(reloaded.getPlanProgress(plan.id)?.percent).toBe(100);
  });
});
