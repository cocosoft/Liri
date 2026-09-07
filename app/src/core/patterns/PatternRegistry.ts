/**
 * Pattern 注册表（Teamwork P2a，2026-09-06）
 *
 * 首批 5 个声明式 pattern（描述层）。selector 按任务特征匹配后返回 pattern 名，
 * 消费方（PDL 决策点等）仅记录/展示，执行仍由既有模块承担。
 */

import type { PatternDescriptor, PatternName } from './types.js';

/** 注册表（数组保序，selector 按声明顺序优先匹配） */
const PATTERNS: PatternDescriptor[] = [
  {
    name: 'iterative_refine',
    displayName: '迭代精修',
    when: '单步生成类任务（需多轮修改打磨产出）',
    matches: { complexity: 'complex', taskType: 'write' },
    roles: ['generator', 'reviewer'],
    composedOf: 'TAORLoop/ReActToolLoop 多轮 + 可选手工/VerifierAgent 校阅',
  },
  {
    name: 'parallel_distributed',
    displayName: '并行分治',
    when: '可拆分为互不依赖子任务的执行型任务',
    matches: { complexity: 'complex', taskType: 'execute' },
    roles: ['planner', 'worker', 'aggregator'],
    composedOf:
      'ParallelAgentScheduler（Semaphore 并发）+ ResultAggregator 聚合',
  },
  {
    name: 'long_task_pdl',
    displayName: '长任务依赖图（PDL）',
    when: '复杂任务走 PDL 分解，步骤带 dependsOn 依赖图（目标驱动主路径）',
    matches: { complexity: 'complex' },
    roles: ['planner', 'step-executor'],
    composedOf:
      'PlanDrivenLoop（TaskDecomposer 分解 + 拓扑批次 + 前驱注入 + 失败门控）',
  },
  {
    name: 'competitive_strategy',
    displayName: '对抗竞争策略',
    when: '研究/决策型任务（多方案权衡、选型建议）——需候选生成 + 对抗批评收敛',
    matches: { complexity: 'complex', research: true },
    roles: ['generator', 'adversarial-reviewer', 'aggregator'],
    composedOf:
      'CompetitiveStrategyOrchestrator（ParallelAgentScheduler 候选 → VerifierAgent 对抗 → BEST_SELECTION 收敛）',
  },
  {
    name: 'self_verify',
    displayName: '自我验证',
    when: '需要内置验证环节的步骤（执行后校验质量）',
    matches: { complexity: 'complex', taskType: 'verify' },
    roles: ['executor', 'verifier'],
    composedOf: 'VerifierAgent（默认 REJECT 立场 + checks 通过率）',
  },
];

/** 按名取描述 */
export function getPatternDescriptor(
  name: PatternName
): PatternDescriptor | undefined {
  return PATTERNS.find((p) => p.name === name);
}

/** 全部已注册 pattern */
export function listPatterns(): PatternDescriptor[] {
  return [...PATTERNS];
}
