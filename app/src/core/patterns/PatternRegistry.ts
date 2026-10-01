/**
 * Pattern 注册表（Teamwork P2a，2026-09-06）
 *
 * 首批 5 个声明式 pattern。selector 按任务特征匹配后返回 pattern 名 + 描述（含装配）。
 * 消费方（分流层等）读 `assembly.assembler` 决定去向；模块实例化仍由既有实现承担。
 *
 * A8（2026-10-01）：原 `composedOf: string` 散文改为结构化 `assembly`（角色→承担方绑定），
 * 使描述可被程序校验与消费。散文不再保留第二份（CS01：同一事实源不得两份）。
 */

import type { PatternDescriptor, PatternName } from './types.js';

/**
 * 注册表（Record 形态 ⇒ 编译期保证对 `PatternName` 全覆盖，取值无 undefined 分支）。
 * 键序 = 声明序，`listPatterns()` 据此返回稳定顺序。
 */
export const PATTERN_DESCRIPTORS: Readonly<
  Record<PatternName, PatternDescriptor>
> = {
  iterative_refine: {
    name: 'iterative_refine',
    displayName: '迭代精修',
    when: '单步生成类任务（需多轮修改打磨产出）',
    matches: { complexity: 'complex', taskType: 'write' },
    roles: ['generator', 'reviewer'],
    assembly: {
      assembler: 'iterative_refine',
      bindings: [
        { role: 'generator', providers: ['taor_loop'] },
        { role: 'reviewer', providers: ['verifier_agent'] },
      ],
    },
  },
  parallel_distributed: {
    name: 'parallel_distributed',
    displayName: '并行分治',
    when: '可拆分为互不依赖子任务的执行型任务',
    matches: { complexity: 'complex', taskType: 'execute' },
    roles: ['planner', 'worker', 'aggregator'],
    assembly: {
      assembler: 'parallel_distributed',
      bindings: [
        { role: 'planner', providers: ['task_decomposer'] },
        { role: 'worker', providers: ['parallel_agent_scheduler'] },
        { role: 'aggregator', providers: ['result_aggregator'] },
      ],
    },
  },
  long_task_pdl: {
    name: 'long_task_pdl',
    displayName: '长任务依赖图（PDL）',
    when: '复杂任务走 PDL 分解，步骤带 dependsOn 依赖图（目标驱动主路径）',
    matches: { complexity: 'complex' },
    roles: ['planner', 'step-executor'],
    assembly: {
      assembler: 'long_task_pdl',
      bindings: [
        { role: 'planner', providers: ['task_decomposer'] },
        {
          role: 'step-executor',
          providers: ['plan_driven_loop', 'taor_loop'],
        },
      ],
    },
  },
  competitive_strategy: {
    name: 'competitive_strategy',
    displayName: '对抗竞争策略',
    when: '研究/决策型任务（多方案权衡、选型建议）——需候选生成 + 对抗批评收敛',
    matches: { complexity: 'complex', research: true },
    roles: ['generator', 'adversarial-reviewer', 'aggregator'],
    assembly: {
      assembler: 'competitive_strategy',
      bindings: [
        {
          role: 'generator',
          providers: [
            'competitive_strategy_orchestrator',
            'parallel_agent_scheduler',
          ],
        },
        { role: 'adversarial-reviewer', providers: ['verifier_agent'] },
        {
          role: 'aggregator',
          providers: ['competitive_strategy_orchestrator'],
        },
      ],
    },
  },
  self_verify: {
    name: 'self_verify',
    displayName: '自我验证',
    when: '需要内置验证环节的步骤（执行后校验质量）',
    matches: { complexity: 'complex', taskType: 'verify' },
    roles: ['executor', 'verifier'],
    assembly: {
      assembler: 'self_verify',
      bindings: [
        { role: 'executor', providers: ['taor_loop'] },
        { role: 'verifier', providers: ['verifier_agent'] },
      ],
    },
  },
};

/** 全部已注册 pattern（注册顺序；返回副本，调用方不可改动注册表） */
export function listPatterns(): PatternDescriptor[] {
  return Object.values(PATTERN_DESCRIPTORS);
}

/** 按名取描述（未知名返回 undefined —— 供 `as never` 探测与外部宽松取值） */
export function getPatternDescriptor(
  name: PatternName
): PatternDescriptor | undefined {
  return PATTERN_DESCRIPTORS[name];
}
