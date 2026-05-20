/**
 * Agent 路由器
 * 按工作区/任务类型路由到不同 Agent 配置
 * 对齐 OpenClaw routing/session-key.ts
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { StrategySelector } from './StrategySelector';
import type { TaskFeature } from './StrategySelector';

const logger = new Logger({ level: LogLevel.INFO });

export interface AgentRoute {
  agentId: string;
  workspaceDir: string;
  model: string;
  provider: string;
  maxTurns: number;
  tools: string[];
  isDefault: boolean;
  isSandboxed: boolean;
}

export interface RouteMatch {
  workspaceDir: string;
  taskType: 'code' | 'chat' | 'refactor' | 'review' | 'test' | 'general';
}

export interface RouteRules {
  patterns: Array<{
    workspacePattern?: RegExp;
    taskTypes: string[];
    agentId: string;
    priority: number;
  }>;
}

export class AgentRouter {
  private routes: Map<string, AgentRoute> = new Map();
  private rules: RouteRules = { patterns: [] };
  private strategySelector: StrategySelector;

  constructor() {
    this.strategySelector = new StrategySelector();
  }

  registerRoute(route: AgentRoute): void {
    this.routes.set(route.agentId, route);
    logger.info(
      `注册路由: ${route.agentId} → ${route.model} (${route.workspaceDir})`
    );
  }

  unregisterRoute(agentId: string): void {
    this.routes.delete(agentId);
  }

  setRules(rules: RouteRules): void {
    this.rules = rules;
    this.rules.patterns.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 基于任务特征选择策略
   * 是 resolve() 的策略增强版本，结合 StrategySelector 做智能匹配
   * @param feature 任务特征
   * @returns 策略选择结果（包含路由和置信度）
   */
  selectStrategy(feature: TaskFeature): {
    route: AgentRoute | null;
    confidence: number;
  } {
    const routes = this.getAllRoutes();
    return this.strategySelector.select(feature, routes);
  }

  /**
   * 获取策略选择器实例（用于配置规则）
   */
  getStrategySelector(): StrategySelector {
    return this.strategySelector;
  }

  resolve(match: RouteMatch): AgentRoute | null {
    // 1. 精准匹配
    for (const route of this.routes.values()) {
      if (route.workspaceDir === match.workspaceDir) {
        return route;
      }
    }

    // 2. 规则匹配
    for (const pattern of this.rules.patterns) {
      if (
        pattern.taskTypes.includes(match.taskType) &&
        (!pattern.workspacePattern ||
          pattern.workspacePattern.test(match.workspaceDir))
      ) {
        const route = this.routes.get(pattern.agentId);
        if (route) return route;
      }
    }

    // 3. 策略匹配（基于任务特征的智能选择）
    const feature = this.strategySelector.analyzeFeature(match);
    const strategyResult = this.strategySelector.select(
      feature,
      this.getAllRoutes()
    );
    if (strategyResult.route && strategyResult.confidence >= 0.5) {
      logger.info('策略匹配路由', {
        agentId: strategyResult.route.agentId,
        confidence: strategyResult.confidence,
      });
      return strategyResult.route;
    }

    // 4. 默认路由
    for (const route of this.routes.values()) {
      if (route.isDefault) return route;
    }

    return null;
  }

  getRoute(agentId: string): AgentRoute | undefined {
    return this.routes.get(agentId);
  }

  getAllRoutes(): AgentRoute[] {
    return Array.from(this.routes.values());
  }

  getDefaultRoute(): AgentRoute | null {
    for (const route of this.routes.values()) {
      if (route.isDefault) return route;
    }
    return null;
  }
}

export const agentRouter = new AgentRouter();
