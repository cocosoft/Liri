/**
 * Mini Agent 集成器
 * 负责将 Mini Agent 集成到现有查询流程
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { ChatMessage } from '../models/types.js';
import type { MiniAgentResult, RouteTarget } from './types.js';
import { MiniAgent } from './MiniAgent.js';
import type { MiniAgentConfig } from './types.js';
import { createMiniAgent } from './MiniAgent.js';

const logger = new Logger({ level: LogLevel.INFO });

export interface MiniAgentIntegrationConfig {
  enabled: boolean;
  miniAgentConfig?: MiniAgentConfig;
  bypassRoutes?: RouteTarget[];
}

export interface IntegrationResult {
  handled: boolean;
  result?: MiniAgentResult;
  shouldContinueToCloud?: boolean;
}

export class MiniAgentIntegrator {
  private miniAgent: MiniAgent | null = null;
  private config: MiniAgentIntegrationConfig;

  constructor(config: MiniAgentIntegrationConfig) {
    this.config = config;
    if (config.enabled && config.miniAgentConfig) {
      this.miniAgent = new MiniAgent(config.miniAgentConfig);
    } else if (config.enabled) {
      this.miniAgent = createMiniAgent();
    }
  }

  isEnabled(): boolean {
    return this.config.enabled && this.miniAgent !== null;
  }

  async process(
    input: string,
    messages?: ChatMessage[]
  ): Promise<IntegrationResult> {
    if (!this.isEnabled()) {
      return { handled: false, shouldContinueToCloud: true };
    }

    try {
      const result = await this.miniAgent!.process(input, messages);

      if (result.routeDecision.target === 'rule_engine') {
        return {
          handled: true,
          result,
          shouldContinueToCloud: false,
        };
      }

      if (this.config.bypassRoutes?.includes(result.routeDecision.target)) {
        return {
          handled: true,
          result,
          shouldContinueToCloud: false,
        };
      }

      return {
        handled: true,
        result,
        shouldContinueToCloud: true,
      };
    } catch (error) {
      logger.error('[MiniAgentIntegrator] Error processing input:', error);
      return { handled: false, shouldContinueToCloud: true };
    }
  }

  updateConfig(config: MiniAgentIntegrationConfig): void {
    this.config = config;
    if (config.enabled && config.miniAgentConfig) {
      this.miniAgent = new MiniAgent(config.miniAgentConfig);
    } else {
      this.miniAgent = null;
    }
  }

  getMiniAgent(): MiniAgent | null {
    return this.miniAgent;
  }
}

export function createMiniAgentIntegrator(
  config?: Partial<MiniAgentIntegrationConfig>
): MiniAgentIntegrator {
  const fullConfig: MiniAgentIntegrationConfig = {
    enabled: config?.enabled ?? false,
    miniAgentConfig: config?.miniAgentConfig,
    bypassRoutes: config?.bypassRoutes ?? [],
  };

  return new MiniAgentIntegrator(fullConfig);
}
