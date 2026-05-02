/**
 * QueryEngine 集成适配器
 * 负责将 Mini Agent 集成到 QueryEngine 的查询流程
 */

import type { ChatMessage } from '../models/types.js';
import type { MiniAgentResult, RouteTarget } from './types.js';
import { MiniAgent } from './MiniAgent.js';
import type { MiniAgentConfig } from './types.js';
import { createMiniAgent } from './MiniAgent.js';
import { createMetricsCollector, type MetricsCollector } from './MetricsCollector.js';
import { createSkillProvider, type SkillProvider } from './SkillProvider.js';

export interface QueryEngineIntegrationConfig {
  enabled: boolean;
  miniAgentConfig?: MiniAgentConfig;
  skillProvider?: SkillProvider;
  bypassRoutes?: RouteTarget[];
  enableMetrics?: boolean;
}

export interface IntegrationResult {
  handled: boolean;
  result?: MiniAgentResult;
  shouldContinueToQueryEngine?: boolean;
  metrics?: {
    latencyMs: number;
    routeTarget: string;
  };
}

export class QueryEngineIntegrationAdapter {
  private miniAgent: MiniAgent | null = null;
  private config: QueryEngineIntegrationConfig;
  private metricsCollector: MetricsCollector;
  private enabled: boolean;

  constructor(config: QueryEngineIntegrationConfig) {
    this.config = config;
    this.enabled = config.enabled;
    this.metricsCollector = createMetricsCollector();

    if (config.enabled) {
      const agentConfig = config.miniAgentConfig || this.createDefaultConfig();
      this.miniAgent = createMiniAgent(agentConfig);

      if (config.skillProvider) {
        this.miniAgent.setSkillProvider(config.skillProvider);
      }
    }
  }

  private createDefaultConfig(): MiniAgentConfig {
    return {
      ollama: {
        enabled: false,
        baseUrl: 'http://localhost:11434',
        defaultModel: 'qwen3:1.8b',
        timeout: 30000,
      },
      routing: {
        strategy: 'cloud-first',
        fallbackToCloud: true,
      },
    };
  }

  isEnabled(): boolean {
    return this.enabled && this.miniAgent !== null;
  }

  async process(input: string, messages?: ChatMessage[]): Promise<IntegrationResult> {
    if (!this.isEnabled()) {
      return { handled: false, shouldContinueToQueryEngine: true };
    }

    const startTime = Date.now();

    try {
      const result = await this.miniAgent!.process(input, messages);
      const latencyMs = Date.now() - startTime;

      if (this.config.enableMetrics) {
        this.metricsCollector.recordRequest(
          result.routeDecision.target,
          latencyMs,
          true,
          input.length,
          result.response.length
        );
      }

      if (result.routeDecision.target === 'rule_engine') {
        return {
          handled: true,
          result,
          shouldContinueToQueryEngine: false,
          metrics: { latencyMs, routeTarget: result.routeDecision.target },
        };
      }

      if (this.config.bypassRoutes?.includes(result.routeDecision.target)) {
        return {
          handled: true,
          result,
          shouldContinueToQueryEngine: false,
          metrics: { latencyMs, routeTarget: result.routeDecision.target },
        };
      }

      return {
        handled: true,
        result,
        shouldContinueToQueryEngine: true,
        metrics: { latencyMs, routeTarget: result.routeDecision.target },
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      if (this.config.enableMetrics) {
        this.metricsCollector.recordRequest('cloud', latencyMs, false, input.length);
      }

      return {
        handled: false,
        shouldContinueToQueryEngine: true,
        metrics: { latencyMs, routeTarget: 'cloud' },
      };
    }
  }

  getMiniAgent(): MiniAgent | null {
    return this.miniAgent;
  }

  getMetricsCollector(): MetricsCollector {
    return this.metricsCollector;
  }

  updateConfig(config: Partial<QueryEngineIntegrationConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.enabled !== undefined) {
      this.enabled = config.enabled;
    }

    if (config.enabled && !this.miniAgent) {
      const agentConfig = config.miniAgentConfig || this.createDefaultConfig();
      this.miniAgent = createMiniAgent(agentConfig);

      if (config.skillProvider) {
        this.miniAgent.setSkillProvider(config.skillProvider);
      }
    }

    if (!config.enabled && this.miniAgent) {
      this.miniAgent = null;
    }
  }

  resetMetrics(): void {
    this.metricsCollector.reset();
  }

  getMetrics(): { totalRequests: number; averageLatencyMs: number; routeEfficiency: number } {
    const metrics = this.metricsCollector.getMetrics();
    const efficiency = this.metricsCollector.getRouteEfficiency();
    return {
      totalRequests: metrics.totalRequests,
      averageLatencyMs: metrics.averageLatencyMs,
      routeEfficiency: efficiency.cloudRate || 0,
    };
  }
}

let globalIntegrationAdapter: QueryEngineIntegrationAdapter | null = null;

export function getGlobalIntegrationAdapter(): QueryEngineIntegrationAdapter {
  if (!globalIntegrationAdapter) {
    globalIntegrationAdapter = new QueryEngineIntegrationAdapter({ enabled: false });
  }
  return globalIntegrationAdapter;
}

export function createIntegrationAdapter(
  config?: Partial<QueryEngineIntegrationConfig>
): QueryEngineIntegrationAdapter {
  return new QueryEngineIntegrationAdapter({
    enabled: config?.enabled ?? false,
    miniAgentConfig: config?.miniAgentConfig,
    skillProvider: config?.skillProvider,
    bypassRoutes: config?.bypassRoutes ?? ['rule_engine'],
    enableMetrics: config?.enableMetrics ?? true,
  });
}
