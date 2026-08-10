import {
  AIAgent,
  AgentConfig,
  AgentState,
  AgentTask,
  AgentResponse,
  AgentSource,
} from '../models/types';
import { AIAgentImpl } from '../agent';
import { AgentSourceManager } from './AgentSourceManager';
import { AgentConfigManager } from './AgentConfigManager';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import type { HealthStatus as HealthStatusValue } from '@modules/core/health/types.js';

const logger = getLogger('agent:managers:multiSourceAgentManager');

interface AgentPoolConfig {
  minSize: number;
  maxSize: number;
  idleTimeout: number;
  healthCheckInterval: number;
}

interface AgentPool {
  source: string;
  config: AgentPoolConfig;
  agents: Map<string, PooledAgent>;
  created: number;
  inUse: number;
}

interface PooledAgent {
  agent: AIAgent;
  createdAt: number;
  lastUsedAt: number;
  inUse: boolean;
  healthStatus: HealthStatusValue;
}

interface HealthStatus {
  healthy: boolean;
  totalAgents: number;
  healthyAgents: number;
  degradedAgents: number;
  unhealthyAgents: number;
  pools: Map<string, PoolHealthInfo>;
}

interface PoolHealthInfo {
  poolId: string;
  total: number;
  healthy: number;
  inUse: number;
  available: number;
}

interface LoadBalanceStrategy {
  selectAgent(
    pools: Map<string, AgentPool>,
    capability?: string
  ): PooledAgent | null;
}

class RoundRobinStrategy implements LoadBalanceStrategy {
  private index: number = 0;

  selectAgent(
    pools: Map<string, AgentPool>,
    capability?: string
  ): PooledAgent | null {
    const poolArray = Array.from(pools.values());
    if (poolArray.length === 0) return null;

    for (let i = 0; i < poolArray.length; i++) {
      const pool = poolArray[this.index % poolArray.length];
      this.index++;

      for (const [, pooledAgent] of pool.agents) {
        if (!pooledAgent.inUse && pooledAgent.healthStatus === 'healthy') {
          return pooledAgent;
        }
      }
    }
    return null;
  }
}

class LeastLoadedStrategy implements LoadBalanceStrategy {
  selectAgent(
    pools: Map<string, AgentPool>,
    capability?: string
  ): PooledAgent | null {
    let bestPool: AgentPool | null = null;
    let lowestLoad = Infinity;

    for (const [, pool] of pools) {
      const inUse = pool.inUse;
      const total = pool.agents.size;
      const load = total > 0 ? inUse / total : 1;

      if (load < lowestLoad) {
        lowestLoad = load;
        bestPool = pool;
      }
    }

    if (bestPool) {
      for (const [, pooledAgent] of bestPool.agents) {
        if (!pooledAgent.inUse && pooledAgent.healthStatus === 'healthy') {
          return pooledAgent;
        }
      }
    }
    return null;
  }
}

export class MultiSourceAgentManager {
  private pools: Map<string, AgentPool> = new Map();
  private sourceManager: AgentSourceManager;
  private configManager: AgentConfigManager;
  private loadBalancer: LoadBalanceStrategy;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private defaultPoolConfig: AgentPoolConfig = {
    minSize: 2,
    maxSize: 10,
    idleTimeout: 300000,
    healthCheckInterval: 60000,
  };

  constructor(
    sourceManager: AgentSourceManager,
    configManager: AgentConfigManager,
    strategy: 'round-robin' | 'least-loaded' = 'least-loaded'
  ) {
    this.sourceManager = sourceManager;
    this.configManager = configManager;
    this.loadBalancer =
      strategy === 'round-robin'
        ? new RoundRobinStrategy()
        : new LeastLoadedStrategy();
  }

  async initialize(): Promise<void> {
    await this.sourceManager.loadAllAgents();
    this.startHealthCheck();
    logger.info('MultiSourceAgentManager initialized');
  }

  createPool(source: string, config: Partial<AgentPoolConfig> = {}): void {
    if (this.pools.has(source)) {
      logger.warn(`Pool ${source} already exists, updating config`);
    }

    const poolConfig: AgentPoolConfig = {
      ...this.defaultPoolConfig,
      ...config,
    };
    const pool: AgentPool = {
      source,
      config: poolConfig,
      agents: new Map(),
      created: 0,
      inUse: 0,
    };

    for (let i = 0; i < poolConfig.minSize; i++) {
      const agent = this.createPoolAgent(source);
      if (agent) {
        pool.agents.set(agent.agent.id, {
          agent: agent.agent,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          inUse: false,
          healthStatus: 'healthy',
        });
        pool.created++;
      }
    }

    this.pools.set(source, pool);
    logger.info(`Created pool ${source} with ${pool.agents.size} agents`);
  }

  async getAvailableAgent(capability?: string): Promise<AIAgent | null> {
    const pooledAgent = this.loadBalancer.selectAgent(this.pools, capability);
    if (pooledAgent) {
      pooledAgent.inUse = true;
      pooledAgent.lastUsedAt = Date.now();
      return pooledAgent.agent;
    }

    for (const [, pool] of this.pools) {
      if (pool.agents.size < pool.config.maxSize) {
        const agent = this.createPoolAgent(pool.source);
        if (agent) {
          const newPooled: PooledAgent = {
            agent: agent.agent,
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
            inUse: true,
            healthStatus: 'healthy',
          };
          pool.agents.set(agent.agent.id, newPooled);
          pool.created++;
          return agent.agent;
        }
      }
    }

    logger.warn('No available agent found');
    return null;
  }

  releaseAgent(agentId: string): void {
    for (const [, pool] of this.pools) {
      const pooledAgent = pool.agents.get(agentId);
      if (pooledAgent) {
        pooledAgent.inUse = false;
        pooledAgent.lastUsedAt = Date.now();
        pool.inUse = Math.max(0, pool.inUse - 1);
        return;
      }
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    const status: HealthStatus = {
      healthy: true,
      totalAgents: 0,
      healthyAgents: 0,
      degradedAgents: 0,
      unhealthyAgents: 0,
      pools: new Map(),
    };

    for (const [poolId, pool] of this.pools) {
      const poolInfo: PoolHealthInfo = {
        poolId,
        total: pool.agents.size,
        healthy: 0,
        inUse: pool.inUse,
        available: 0,
      };

      for (const [agentId, pooledAgent] of pool.agents) {
        status.totalAgents++;
        const isHealthy = await this.checkAgentHealth(pooledAgent.agent);
        pooledAgent.healthStatus = isHealthy ? 'healthy' : 'unhealthy';

        if (isHealthy) {
          status.healthyAgents++;
          poolInfo.healthy++;
          if (!pooledAgent.inUse) {
            poolInfo.available++;
          }
        } else {
          status.unhealthyAgents++;
        }
      }

      status.pools.set(poolId, poolInfo);
      if (poolInfo.healthy < poolInfo.total) {
        status.healthy = false;
      }
    }

    return status;
  }

  balanceLoad(): void {
    let maxLoad = 0;
    let minLoad = Infinity;
    let maxLoadPool: AgentPool | null = null;
    let minLoadPool: AgentPool | null = null;

    for (const [, pool] of this.pools) {
      const load = pool.agents.size > 0 ? pool.inUse / pool.agents.size : 0;
      if (load > maxLoad) {
        maxLoad = load;
        maxLoadPool = pool;
      }
      if (load < minLoad) {
        minLoad = load;
        minLoadPool = pool;
      }
    }

    if (maxLoadPool && minLoadPool && maxLoad - minLoad > 0.3) {
      for (const [agentId, pooledAgent] of maxLoadPool.agents) {
        if (!pooledAgent.inUse) {
          maxLoadPool.agents.delete(agentId);
          maxLoadPool.inUse = Math.max(0, maxLoadPool.inUse - 1);
          minLoadPool.agents.set(agentId, pooledAgent);
          logger.debug(
            `Moved agent ${agentId} from ${maxLoadPool.source} to ${minLoadPool.source}`
          );
          break;
        }
      }
    }
  }

  getPoolStats(): Map<
    string,
    { total: number; inUse: number; available: number; healthy: number }
  > {
    const stats = new Map<
      string,
      { total: number; inUse: number; available: number; healthy: number }
    >();
    for (const [poolId, pool] of this.pools) {
      let healthy = 0;
      let available = 0;
      for (const [, agent] of pool.agents) {
        if (agent.healthStatus === 'healthy') healthy++;
        if (!agent.inUse && agent.healthStatus === 'healthy') available++;
      }
      stats.set(poolId, {
        total: pool.agents.size,
        inUse: pool.inUse,
        available,
        healthy,
      });
    }
    return stats;
  }

  async shutdown(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    this.pools.clear();
    logger.info('MultiSourceAgentManager shut down');
  }

  private createPoolAgent(source: string): { agent: AIAgent } | null {
    try {
      const config = this.configManager.loadConfig(source);
      const agent = new AIAgentImpl(config);
      return { agent };
    } catch (error) {
      handleError(error, {
        module: 'agent:manager',
        action: '创建Agent池实例',
      });
      return null;
    }
  }

  private async checkAgentHealth(agent: AIAgent): Promise<boolean> {
    try {
      const testTask: AgentTask = {
        id: `health_${Date.now()}`,
        name: 'health_check',
        description: 'Internal health check task',
        input: { type: 'health_check' },
      };
      const response = await agent.execute(testTask);
      return response.status !== AgentState.FAILED;
    } catch {
      return false;
    }
  }

  private startHealthCheck(): void {
    const interval = this.defaultPoolConfig.healthCheckInterval;
    this.healthCheckTimer = setInterval(async () => {
      try {
        const status = await this.healthCheck();
        if (!status.healthy) {
          logger.warn('Health check detected unhealthy agents, rebalancing');
          this.balanceLoad();
        }
      } catch (error) {
        handleError(error, {
          module: 'agent:manager',
          action: 'Agent健康检查',
        });
      }
    }, interval);
  }
}
