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
    // D2（2026-10-04，pattern-trigger-surfaces.md）：原 `taskType: 'write'` 在本仓**无生产者**
    // （真实 `TaskType` 见 ai/modelRouter.ts，是另一套词表）⇒ 悬空判定依据已移除，语义由 `when` 表达。
    matches: { complexity: 'complex' },
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
    // D2：原 `taskType: 'execute'` 悬空（无生产者）⇒ 已移除；语义由 `when` 表达。
    matches: { complexity: 'complex' },
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
    // D2（2026-10-04，pattern-assembly-runtime.md §5）：描述层改为**与运行时一致**。
    // 原 when 写「复杂任务走 PDL 分解」与运行时相反 —— PlanDrivenLoop 实际承接的是
    // 快速路径（simple 且无危险意图，`isEligibleForFastPath`），复杂任务走 PDCA 阶段链
    // （见 ChatManager._shouldUsePlanDrivenLoop）。
    // ⚠️ 遗留：`selectPattern` 对 complex 非研究仍返回本 pattern（N1 冻结判定规则），
    // 与下方 matches 不一致 ⇒ 已登记为预存语义债（见 spec §9）。
    when: '简单且无危险意图的任务走 PlanDrivenLoop 快速路径直接执行；复杂任务走 PDCA 阶段链（不经 PDL）',
    matches: { complexity: 'simple' },
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
    // D2：原 `taskType: 'verify'` 悬空（无生产者）⇒ 已移除；语义由 `when` 表达。
    matches: { complexity: 'complex' },
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
