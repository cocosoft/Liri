/**
 * P0-1 接线期① 回归基线：`WorkflowEngine.orderSteps()` 改由图内核算序后，
 * **执行序必须与既有语义完全一致**。
 *
 * 背景（重要）：本文件是 `WorkflowEngine` 的**首个**用例 —— 此前该 seam 无任何测试，
 * 因此"接线不改变行为"这条验收只能靠本文件首次固化。断言以**声明序保持**为核心：
 * 内核的并列打破规则从"按 id 升序"改为"按插入序（=声明序）"正是为了这一条。
 */

import { describe, it, expect } from 'bun:test';

import { WorkflowEngine } from '../../../src/modules/workflow/index.js';
import type {
  WorkflowDefinition,
  WorkflowStepSpec,
} from '../../../src/modules/workflow/index.js';

function define(steps: WorkflowStepSpec[]): WorkflowDefinition {
  return { name: 'test-flow', description: 'orderSteps 回归', steps };
}

/** 无 tool 需求的占位步骤 */
function step(id: string, dependsOn?: string[]): WorkflowStepSpec {
  return {
    id,
    description: `步骤 ${id}`,
    tool: 'noop',
    ...(dependsOn ? { dependsOn } : {}),
  };
}

describe('orderSteps：无依赖时保持声明顺序', () => {
  it('非字典序 id 也保持声明序（证明并列打破依据是插入序，不是 id 排序）', () => {
    const engine = new WorkflowEngine();
    const steps = [step('s9'), step('s1'), step('s5')];
    expect(engine.orderSteps(define(steps)).map((s) => s.id)).toEqual([
      's9',
      's1',
      's5',
    ]);
  });

  it('返回的是 definition 中的**同一对象引用**（保持既有实现语义）', () => {
    const engine = new WorkflowEngine();
    const steps = [step('a'), step('b')];
    const ordered = engine.orderSteps(define(steps));
    expect(ordered[0]).toBe(steps[0]);
    expect(ordered[1]).toBe(steps[1]);
  });
});

describe('orderSteps：依赖约束下保持稳定序', () => {
  it('链式依赖：前提在前', () => {
    const engine = new WorkflowEngine();
    const steps = [step('c', ['b']), step('b', ['a']), step('a')];
    expect(engine.orderSteps(define(steps)).map((s) => s.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('独立步骤不被无谓移动（声明序优先，约束满足即可）', () => {
    const engine = new WorkflowEngine();
    // z 独立；y 依赖 x ⇒ x 必须在 y 前；z 与二者无约束 ⇒ 应保持在最前（声明序）
    const steps = [step('z'), step('x'), step('y', ['x'])];
    expect(engine.orderSteps(define(steps)).map((s) => s.id)).toEqual([
      'z',
      'x',
      'y',
    ]);
  });

  it('菱形依赖：汇聚点排在两条上游之后', () => {
    const engine = new WorkflowEngine();
    const steps = [
      step('root'),
      step('left', ['root']),
      step('right', ['root']),
      step('join', ['left', 'right']),
    ];
    const order = engine.orderSteps(define(steps)).map((s) => s.id);
    expect(order.indexOf('join')).toBe(order.length - 1);
    expect(order.indexOf('root')).toBe(0);
  });
});

describe('orderSteps：图不可用时回退（既有兜底语义，且不抛错）', () => {
  it('成环 ⇒ 回退声明顺序，不抛错（validate 才负责抛 WORKFLOW_DEPENDENCY_CYCLE）', () => {
    const engine = new WorkflowEngine();
    const steps = [step('a', ['b']), step('b', ['a'])];
    expect(engine.orderSteps(define(steps)).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('依赖缺失 ⇒ 回退声明顺序，不抛错', () => {
    const engine = new WorkflowEngine();
    const steps = [step('a'), step('b', ['ghost'])];
    expect(engine.orderSteps(define(steps)).map((s) => s.id)).toEqual(['a', 'b']);
  });
});
