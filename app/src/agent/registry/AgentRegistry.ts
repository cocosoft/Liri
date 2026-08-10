/**
 * AgentRegistry — 动态 Agent 注册与发现中心
 *
 * 单例模式，提供 Agent 注册、按条件发现、缓存和热更新能力。
 * 按 session 隔离缓存，防止多 session 并发干扰。
 * 替代 CouncilOrchestrator / SwarmCoordinator / AgentChain 中的硬编码 Agent 列表。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

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
   * 使所有 session 的缓存失效
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
 * 获取全局 AgentRegistry 单例
 */
export function getAgentRegistry(cacheTTL?: number): AgentRegistry {
  return AgentRegistry.getInstance(cacheTTL);
}

/** 全局默认 AgentRegistry 单例 */
export const agentRegistry = AgentRegistry.getInstance();
