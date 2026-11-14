// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 负载感知路由（D4 一期，2026-11-14）
 *
 * 现状（取证，详见 `.trae/specs/agent-load-routing.md`）：
 * - 选择顺序只有**静态 `priority` 降序**（`AgentRegistry.discoverAgents`）；
 * - **没有任何生产点位**"给一个需求 → 按条件挑人"（`assignAgentsByGraph` 生产零调用，
 *   `graph-engineering-p0.md` 已如实登记；Council 只"加载全部启用角色"）；
 * - 负载事实源 `AgentRunLedger.listActive()` 的投影**按运行（type）**而非注册表 `agentId`
 *   （`AgentRunView` 无 `agentId` 字段）⇒ 按 agent 维度的负载记账尚不存在。
 *
 * 因此本期只落**可复用的排序原语 + 两种负载聚合适配器**，不改变任何既有生产行为：
 * - 排序在**全零负载**时与原 `priority` 顺序**逐条一致**（稳定排序，无额外 tiebreak）；
 * - 只有调用方显式 `routeByLoad: true` 并注入负载时才生效（`assignAgentsByGraph` 的第二参）。
 */

/** 可路由 agent 的最小面（与 `AgentDefinition` 结构兼容） */
export interface RoutableAgent {
  agentId: string;
  /** 选择优先级（1-10；缺省 5，与 `discoverAgents` 同口径） */
  priority?: number;
}

/** 默认优先级（与 `AgentRegistry.discoverAgents` 的 `?? 5` 一致） */
export const DEFAULT_AGENT_PRIORITY = 5;

export interface LoadRankOptions {
  /**
   * 单个 agent 的在跑上限：达到/超过 ⇒ 不参与本次选择（移入 `atCapacity`）。
   * 缺省 ⇒ 不做容量过滤（只排序）。
   */
  maxInFlightPerAgent?: number;
}

export interface LoadRankResult<T extends RoutableAgent> {
  /** 可选的候选（在跑数升序 → 优先级降序；稳定排序） */
  ranked: T[];
  /** 因达到在跑上限被排除的候选（保留给调用方记录/降级判断） */
  atCapacity: T[];
}

/** 按 `agentId` 聚合在跑数（纯函数；重复 id 累加） */
export function collectAgentLoads(
  activeRuns: ReadonlyArray<{ agentId: string }>
): Map<string, number> {
  const loads = new Map<string, number>();
  for (const run of activeRuns) {
    loads.set(run.agentId, (loads.get(run.agentId) ?? 0) + 1);
  }
  return loads;
}

/**
 * 按**运行类型**聚合在跑数（纯函数）。
 *
 * 适配 `AgentRunLedger.listActive()` 的 `AgentRunView`（字段 `type`，无 `agentId`）——
 * 供"注册表 agent 与运行类型 1:1 对齐"的调用方使用；不对齐时不要用它冒充 agent 维度。
 */
export function collectLoadsByType(
  activeRuns: ReadonlyArray<{ type: string }>
): Map<string, number> {
  const loads = new Map<string, number>();
  for (const run of activeRuns) {
    loads.set(run.type, (loads.get(run.type) ?? 0) + 1);
  }
  return loads;
}

/**
 * 负载感知排序（纯函数，**稳定**）。
 *
 * 比较顺序：① 在跑数升序（负载低的优先）→ ② 优先级降序（与原 `discoverAgents` 一致）。
 * 全零负载 ⇒ 结果与入参顺序逐条一致（稳定排序 + 同优先级不重排）。
 *
 * @param loads `agentId → 在跑数`（缺项视为 0）
 */
export function rankAgentsByLoad<T extends RoutableAgent>(
  candidates: readonly T[],
  loads: ReadonlyMap<string, number>,
  options: LoadRankOptions = {}
): LoadRankResult<T> {
  const inFlight = (agentId: string): number => loads.get(agentId) ?? 0;
  const cap = options.maxInFlightPerAgent;

  const ranked: T[] = [];
  const atCapacity: T[] = [];
  for (const candidate of candidates) {
    if (cap !== undefined && inFlight(candidate.agentId) >= cap) {
      atCapacity.push(candidate);
    } else {
      ranked.push(candidate);
    }
  }

  ranked.sort(
    (a, b) =>
      inFlight(a.agentId) - inFlight(b.agentId) ||
      (b.priority ?? DEFAULT_AGENT_PRIORITY) -
        (a.priority ?? DEFAULT_AGENT_PRIORITY)
  );
  return { ranked, atCapacity };
}
