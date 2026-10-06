// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 编排 pattern 的「承担方解析层」（T-①04 T1-3 · 方案 A）
 *
 * 职责：把 `PatternProvider` 闭集里的**稳定 ID** 解析到**现有实现**（模块 + 符号），
 * 使注册表里的 `assembly.bindings` **无悬空**（每个引用到的 provider 都有落点）。
 *
 * 边界（如实 · CS03）：
 * - 本层**只解析、不实例化、不加载** —— 8 位 provider 的构造签名**异构且部分很重**
 *   （`QueryEngine` / `AgentExecutor` / `PlanDrivenLoopConfig` / `CompetitiveOrchestratorConfig`…）；
 *   真正 `new`/`create` 出编排属**方案 B**，已另立专项（见 spec §10）。
 * - 因此本层给的是**定位**（`impl` + `locator`），不是运行期值引用 —— 这是"闭集无悬空"
 *   判据（spec §7-3）所需的最小事实，不引入空转的装配器。
 *
 * 完备性由**两重**保证：
 * 1. **编译期**：`Record<PatternProvider, …>` —— 闭集增项而漏配即编译失败；
 * 2. **运行期**：`findUnboundProviders()` 双向比对 `PATTERN_PROVIDERS`（供契约自检）。
 *
 * 分层：本文件属 **app 层**（`query`），依赖 core 层 barrel `@modules/core`（合法方向）。
 */

import {
  PATTERN_PROVIDERS,
  type PatternAssembly,
  type PatternProvider,
} from '@modules/core';

/** 单个 provider ID 的实现定位（诊断/自检用；CS02：非用户可见文案） */
export interface PatternProviderBinding {
  /** 现有实现名（类名或工厂名） */
  impl: string;
  /** 实现定位（模块路径 + 符号），便于人工核对与后续 B 落地 */
  locator: string;
}

/**
 * provider ID → 现有实现定位（**闭集全覆盖**；`Record` 形态编译期保证无漏配）。
 *
 * 取证来源（T1-3 §10.1）：8 位 provider 均已存在实现，此前仅因从未被引用而看似缺失。
 */
export const PATTERN_PROVIDER_BINDINGS: Readonly<
  Record<PatternProvider, PatternProviderBinding>
> = {
  taor_loop: {
    impl: 'TAORLoop',
    // 2026-10-06（spec file-size-debt-partition-plan §42 拆分后订正行号）
    locator: 'query/TAORLoop.ts#TAORLoop（工厂 createTAORLoop:1977）',
  },
  react_tool_loop: {
    impl: 'ReActToolLoop',
    locator: 'chat/ReActToolLoop.ts#ReActToolLoop:237',
  },
  parallel_agent_scheduler: {
    impl: 'ParallelAgentScheduler',
    locator: 'agent/moa/ParallelAgentScheduler.ts#ParallelAgentScheduler:154',
  },
  result_aggregator: {
    impl: 'ResultAggregator',
    locator: 'agent/moa/ResultAggregator.ts#ResultAggregator:146',
  },
  plan_driven_loop: {
    impl: 'PlanDrivenLoop',
    locator: 'tasks/PlanDrivenLoop.ts#PlanDrivenLoop:208',
  },
  task_decomposer: {
    impl: 'TaskDecomposer',
    locator: 'ai/router/TaskDecomposer.ts#TaskDecomposer:137',
  },
  competitive_strategy_orchestrator: {
    impl: 'CompetitiveStrategyOrchestrator',
    locator:
      'query/CompetitiveStrategyOrchestrator.ts#CompetitiveStrategyOrchestrator:177（装配点 runResearchOrchestration:452）',
  },
  verifier_agent: {
    impl: 'VerifierAgent',
    locator:
      'query/VerifierAgent.ts#VerifierAgent:215（工厂 createVerifierAgent:456）',
  },
};

/** 解析单个 provider ID → 实现定位（`Record` 保证存在，无 undefined 分支） */
export function resolvePatternProvider(
  id: PatternProvider
): PatternProviderBinding {
  return PATTERN_PROVIDER_BINDINGS[id];
}

/** 展开一个 `PatternAssembly` 的全部承担方（角色 → provider → 实现定位） */
export function resolveAssemblyProviders(assembly: PatternAssembly): Array<{
  role: string;
  provider: PatternProvider;
  binding: PatternProviderBinding;
}> {
  return assembly.bindings.flatMap((b) =>
    b.providers.map((provider) => ({
      role: b.role,
      provider,
      binding: PATTERN_PROVIDER_BINDINGS[provider],
    }))
  );
}

/**
 * 闭集与绑定表的**双向差集**（恒为空数组 = 无悬空）。
 * 双向：① 闭集有而绑定缺；② 绑定有而闭集无（防止手写键漂移）。
 * 仅供契约自检消费（沿 `validatePatterns()` 先例：注册表是编译期常量，不做启动期校验 —— CS03）。
 */
export function findUnboundProviders(): string[] {
  const problems: string[] = [];
  const bound = new Set(Object.keys(PATTERN_PROVIDER_BINDINGS));
  const closedSet = new Set<string>(PATTERN_PROVIDERS);

  for (const id of PATTERN_PROVIDERS) {
    if (!bound.has(id)) problems.push(`闭集 provider 无绑定：${id}`);
  }
  for (const id of bound) {
    if (!closedSet.has(id)) problems.push(`绑定含闭集外 provider：${id}`);
  }
  return problems;
}
