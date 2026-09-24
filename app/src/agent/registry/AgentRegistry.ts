/**
 * AgentRegistry — 动态 Agent 注册与发现中心
 *
 * 单例模式，提供 Agent 注册、按条件发现、缓存和热更新能力。
 * 按 session 隔离缓存，防止多 session 并发干扰。
 * 替代 CouncilOrchestrator / SwarmCoordinator / AgentChain 中的硬编码 Agent 列表。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import {
  SystemGraph,
  projectAgentGraph,
  type AgentLike,
} from '@modules/core/systemgraph';

const logger = getLogger('AgentRegistry');

/** Agent 注册定义 */
export interface AgentDefinition {
  /** 唯一 ID */
  agentId: string;
  /** 可读名称 */
  name: string;
  /** 角色标识（如 'market_analyst' | 'tech_architect' | 'legal_advisor'） */
  role: string;
  /** 专业领域列表，与 CouncilAgentRole.expertise 一致 */
  expertise: string[];
  /** 发言权重（0-1），与 CouncilAgentRole.weight 一致 */
  weight: number;
  /** 可选能力标签（如 'code_review', 'testing', 'deployment'） */
  capabilities?: string[];
  /** 推荐模型 */
  model?: string;
  /** 角色系统提示词，与 CouncilAgentRole.systemPrompt 一致 */
  systemPrompt?: string;
  /** 选择优先级（1-10，越高越优先被选中） */
  priority?: number;
}

/** 发现条件 */
export interface DiscoverCriteria {
  /** 按专业领域筛选（取交集） */
  expertise?: string[];
  /** 按能力标签筛选 */
  capability?: string;
  /** 最低优先级 */
  minPriority?: number;
  /** 最多返回数量 */
  limit?: number;
}

// ─── 按图分配（P0-1 接线期③，2026-09-24）──────────────────────────────────

/**
 * 分配目标：一条待分配的工作项（结构化入参，将成为系统图的 `task` 节点）。
 *
 * 字段与 `DiscoverCriteria` 同源（同样走 `discoverAgents()` 的筛选语义），
 * 差异只在语义：这里是"这个工作项**需要什么**"，而非"我要查什么"。
 */
export interface AgentAssignmentTarget {
  /** 工作项 id（图中 `task` 节点 id） */
  targetId: string;
  /** 需要的专业领域（与 `agent.expertise` 取交集，任一命中即候选） */
  expertise?: string[];
  /** 需要的能力标签 */
  capability?: string;
  /** 最低优先级（缺省 5，与 `discoverAgents` 一致） */
  minPriority?: number;
  /** 最多分配几个 agent（默认 1） */
  limit?: number;
}

/** 单条分配结果 */
export interface AgentAssignment {
  targetId: string;
  /** 选中的 agent id（按优先级降序，最多 `limit` 个；**无满足条件者 ⇒ 空数组**，不虚构占位） */
  agentIds: string[];
  /** 该目标的候选池（按优先级降序，**未截断**；供改派与"为什么选它"复核） */
  candidates: AgentDefinition[];
}

/** 分配结果 + 落好 `assignedTo` 边的系统图 */
export interface AgentAssignmentResult {
  assignments: AgentAssignment[];
  /**
   * 系统图：`task` 节点（= 目标）+ 被选中 agent 的 `agent` 节点 + `assignedTo` 边。
   *
   * **方向**：`from` = 执行者(agent) → `to` = 被指派的任务（与 `core/systemgraph`
   * 的全局方向约定一致）⇒ 对某目标调 `findRootCauseCandidates(targetId)` 即可把它
   * 的参与 agent 列为候选（权重 0.2 弱因果：执行者存在不代表结论有误）。
   */
  graph: SystemGraph;
}

/** 变更通知类型 */
export type RegistryChangeAction = 'add' | 'remove' | 'update';

/** 变更监听器 */
export type RegistryChangeListener = (
  action: RegistryChangeAction,
  agent: AgentDefinition
) => void;

const DEFAULT_CACHE_TTL = 30_000; // 30s

/**
 * 动态 Agent 注册与发现中心
 *
 * 跨 session 隔离说明：
 * - Agent 注册表（agents）是全局共享的，所有 session 看到相同的 Agent 池
 * - 发现结果缓存（sessionCaches）按 sessionId 独立，避免多 session 并发时缓存污染
 * - registerAgent / unregisterAgent 会清除所有 session 的缓存
 * - 每个 session 可调用 clearSessionCache() 独立清理自己的缓存
 */
export class AgentRegistry {
  private static instance: AgentRegistry;

  /** agentId → AgentDefinition（全局共享） */
  private agents: Map<string, AgentDefinition> = new Map();

  /** sessionId → (cacheKey → discover结果) 按 session 隔离的缓存 */
  private sessionCaches: Map<string, Map<string, AgentDefinition[]>> =
    new Map();
  /** sessionId → 最后刷新时间 */
  private sessionLastRefresh: Map<string, number> = new Map();
  private cacheTTL: number;

  /** 变更监听器 */
  private onChangeListeners: Set<RegistryChangeListener> = new Set();

  private constructor(cacheTTL: number = DEFAULT_CACHE_TTL) {
    this.cacheTTL = cacheTTL;
  }

  /**
   * 获取全局单例
   */
  static getInstance(cacheTTL?: number): AgentRegistry {
    if (!AgentRegistry.instance) {
      AgentRegistry.instance = new AgentRegistry(cacheTTL);
    }
    return AgentRegistry.instance;
  }

  // ==================== 变更监听 ====================

  /**
   * 注册变更监听器
   * @returns 取消监听的函数
   */
  onChanged(listener: RegistryChangeListener): () => void {
    this.onChangeListeners.add(listener);
    return () => {
      this.onChangeListeners.delete(listener);
    };
  }

  // ==================== 注册 / 注销 ====================

  /**
   * 注册一个 Agent
   * @param definition Agent 定义
   */
  registerAgent(definition: AgentDefinition): void {
    this.agents.set(definition.agentId, definition);
    this.invalidateCache();
    this.notifyChanged('add', definition);
    logger.info(`Agent 注册: ${definition.agentId} (${definition.name})`);
  }

  /**
   * 注册多个 Agent
   */
  registerAgents(definitions: AgentDefinition[]): void {
    for (const def of definitions) {
      this.agents.set(def.agentId, def);
    }
    this.invalidateCache();
    logger.info(`批量注册 ${definitions.length} 个 Agent`);
  }

  /**
   * 注销一个 Agent
   */
  unregisterAgent(agentId: string): void {
    const def = this.agents.get(agentId);
    if (!def) return;

    this.agents.delete(agentId);
    this.invalidateCache();
    this.notifyChanged('remove', def);
    logger.info(`Agent 注销: ${agentId}`);
  }

  // ==================== 发现 ====================

  /**
   * 按条件发现 Agent
   * @param criteria 筛选条件
   * @param sessionId 可选 session ID（用于缓存隔离）
   * @returns 匹配的 Agent 列表（按 priority 降序）
   */
  discoverAgents(
    criteria: DiscoverCriteria = {},
    sessionId?: string
  ): AgentDefinition[] {
    const cacheKey = JSON.stringify(criteria);
    const now = Date.now();

    // 按 session 隔离缓存查找
    if (sessionId && this.sessionCaches.has(sessionId)) {
      const sessionCache = this.sessionCaches.get(sessionId)!;
      const lastRefresh = this.sessionLastRefresh.get(sessionId) ?? 0;
      if (sessionCache.has(cacheKey) && now - lastRefresh < this.cacheTTL) {
        return sessionCache.get(cacheKey)!;
      }
    }

    let results = Array.from(this.agents.values());

    // 按专业领域筛选
    if (criteria.expertise && criteria.expertise.length > 0) {
      results = results.filter((agent) =>
        criteria.expertise!.some((exp) => agent.expertise.includes(exp))
      );
    }

    // 按能力标签筛选
    if (criteria.capability) {
      results = results.filter(
        (agent) =>
          agent.capabilities &&
          agent.capabilities.includes(criteria.capability!)
      );
    }

    // 按优先级筛选
    if (criteria.minPriority !== undefined) {
      results = results.filter(
        (agent) => (agent.priority ?? 5) >= criteria.minPriority!
      );
    }

    // 按 priority 降序排列（高的优先）
    results.sort((a, b) => (b.priority ?? 5) - (a.priority ?? 5));

    // 限制返回数量
    if (criteria.limit && results.length > criteria.limit) {
      results = results.slice(0, criteria.limit);
    }

    // 按 session 写入缓存
    if (sessionId) {
      if (!this.sessionCaches.has(sessionId)) {
        this.sessionCaches.set(sessionId, new Map());
      }
      this.sessionCaches.get(sessionId)!.set(cacheKey, results);
      this.sessionLastRefresh.set(sessionId, now);
    }

    return results;
  }

  /**
   * 获取单个 Agent
   */
  getAgent(agentId: string): AgentDefinition | undefined {
    return this.agents.get(agentId);
  }

  // ==================== 按图分配（P0-1 接线期③） ====================

  /**
   * 按图分配：为每个目标挑选 agent，并把分配关系落为系统图的 `assignedTo` 边。
   *
   * 目的：让"某工作项失败了 ⇒ 是不是被指派去做的那个 agent 的问题"可被
   * `SystemGraph.findRootCauseCandidates(targetId)` 回溯（弱因果权重 0.2）。
   *
   * **复用而非另建**：筛选/排序/会话缓存全部走既有 `discoverAgents()`（CS01 归一化）
   * —— 候选池与直接调用 `discoverAgents()` **逐条一致**（有测试固化）。
   *
   * **零副作用**：本方法不修改注册表、不写缓存之外的状态，也不改变既有
   * `discoverAgents()` 调用方（CouncilOrchestrator 等）的任何行为。
   *
   * @param targets 待分配的目标（空数组 ⇒ 空结果 + 空图）
   * @param sessionId 可选 session（透传给 `discoverAgents` 的缓存隔离）
   */
  assignAgentsByGraph(
    targets: readonly AgentAssignmentTarget[],
    sessionId?: string
  ): AgentAssignmentResult {
    const assignments: AgentAssignment[] = targets.map((target) => {
      const criteria: DiscoverCriteria = {
        ...(target.expertise && target.expertise.length > 0
          ? { expertise: [...target.expertise] }
          : {}),
        ...(target.capability ? { capability: target.capability } : {}),
        ...(target.minPriority !== undefined
          ? { minPriority: target.minPriority }
          : {}),
      };
      const candidates = this.discoverAgents(criteria, sessionId);
      const limit = target.limit ?? 1;
      return {
        targetId: target.targetId,
        agentIds: candidates.slice(0, limit).map((agent) => agent.agentId),
        candidates,
      };
    });

    const graph = buildAssignmentGraph(assignments, this.agents);
    logger.info('按图分配完成', {
      targetCount: targets.length,
      assignedTargetCount: assignments.filter((a) => a.agentIds.length > 0)
        .length,
      agentNodeCount: graph.listNodes('agent').length,
      edgeCount: graph.listEdges().length,
    });
    return { assignments, graph };
  }

  /**
   * 获取 Agent 的能力标签
   */
  getAgentCapabilities(agentId: string): string[] {
    return this.agents.get(agentId)?.capabilities ?? [];
  }

  /**
   * 列出所有已注册的 Agent
   */
  listAll(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  // ==================== 内部方法 ====================

  /**
   * 使所有 session 的缓存失效（`registerAgent` / `registerAgents` / `unregisterAgent` 内部调用）。
   *
   * O17：**收回为 private** —— O11-3 曾将其暴露给 `/v1/agent-roles` 的写路径，但该路径
   * 清理的是 `discover()` 的会话缓存，与角色解析链（① DB 直查、② 直读 `agents` Map）
   * **无交集** ⇒ 对目标路径零作用。该链现在改为刷新工具 schema 的可用清单快照
   * （`refreshAvailableSubagentTypeNames()`），本方法回归"注册表自身操作后的内部失效"。
   */
  private invalidateCache(): void {
    this.sessionCaches.clear();
    this.sessionLastRefresh.clear();
  }

  /**
   * 清除指定 session 的缓存
   * @param sessionId 会话 ID
   */
  clearSessionCache(sessionId: string): void {
    this.sessionCaches.delete(sessionId);
    this.sessionLastRefresh.delete(sessionId);
  }

  /**
   * 通知所有监听器
   */
  private notifyChanged(
    action: RegistryChangeAction,
    agent: AgentDefinition
  ): void {
    for (const listener of this.onChangeListeners) {
      try {
        listener(action, agent);
      } catch (error) {
        handleError(error, {
          module: 'agent:registry',
          action: '变更监听器回调',
        });
      }
    }
  }

  // ==================== 测试支持 ====================

  /**
   * 重置实例（仅测试用）
   */
  static resetInstance(): void {
    const instance = new AgentRegistry();
    instance.sessionCaches.clear();
    instance.sessionLastRefresh.clear();
    AgentRegistry.instance = instance;
  }
}

/**
 * `AgentDefinition` → `AgentLike`（`core/systemgraph` 的结构化入参）。
 *
 * 字段名不同（`agentId` vs `id`）：core 保持领域无关、不感知 `agentId` 命名，
 * 由领域侧做这一次映射。
 */
function toAgentLike(agent: AgentDefinition): AgentLike {
  return {
    id: agent.agentId,
    role: agent.role,
    ...(agent.capabilities ? { capabilities: agent.capabilities } : {}),
    expertise: agent.expertise,
  };
}

/**
 * 把分配结果投影为系统图（P0-1 接线期③）。
 *
 * - **agent 节点**：形状复用 `core/systemgraph` 的 `projectAgentGraph`（不另抄一份）；
 *   仅包含**被选中**的 agent（未参与分配者不入图，避免无关节点噪声）。
 * - **task 节点 + `assignedTo` 边**：由本函数补入 —— 二者是**运行期事实**，
 *   静态投影函数无法预知（见 `projectAgentGraph` 的注释）。
 * - `evidenceRef`：`agent_registry:<agentId>`，即"该边由注册表中这条 agent 记录支撑"。
 */
function buildAssignmentGraph(
  assignments: readonly AgentAssignment[],
  agents: ReadonlyMap<string, AgentDefinition>
): SystemGraph {
  const chosen: AgentDefinition[] = [];
  for (const assignment of assignments) {
    for (const agentId of assignment.agentIds) {
      const agent = agents.get(agentId);
      if (agent && !chosen.some((item) => item.agentId === agentId)) {
        chosen.push(agent);
      }
    }
  }

  const graph = new SystemGraph(
    projectAgentGraph(chosen.map(toAgentLike)).snapshot()
  );
  for (const assignment of assignments) {
    graph.addNode({ id: assignment.targetId, kind: 'task' });
    for (const agentId of assignment.agentIds) {
      // 选中的 agent 必已在图中（上面按 chosen 建过）；缺失只可能是注册表并发注销 ⇒ 跳过该边
      if (!graph.hasNode(agentId)) continue;
      graph.addEdge({
        from: agentId,
        to: assignment.targetId,
        kind: 'assignedTo',
        evidenceRef: `agent_registry:${agentId}`,
      });
    }
  }
  return graph;
}

/**
 * 获取全局 AgentRegistry 单例
 */
export function getAgentRegistry(cacheTTL?: number): AgentRegistry {
  return AgentRegistry.getInstance(cacheTTL);
}

/** 全局默认 AgentRegistry 单例 */
// 惰性初始化：模块顶层直接 AgentRegistry.getInstance() 会在本模块被
// core/workspace 求值链提前加载时触发类 TDZ（循环导入）。
let _agentRegistry: AgentRegistry | undefined;
function getDefaultAgentRegistry(): AgentRegistry {
  _agentRegistry ??= AgentRegistry.getInstance();
  return _agentRegistry;
}
export const agentRegistry = new Proxy({} as AgentRegistry, {
  get(_, prop: keyof AgentRegistry) {
    const instance = getDefaultAgentRegistry();
    const value = instance[prop];
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  },
});
