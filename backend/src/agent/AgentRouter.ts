/**
 * Agent 路由器
 * 按工作区/任务类型路由到不同 Agent 配置
 * 对齐 OpenClaw routing/session-key.ts
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

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

    // 3. 默认路由
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
