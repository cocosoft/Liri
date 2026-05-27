/**
 * 策略选择器
 * 基于任务特征矩阵自动匹配最佳 Agent 策略
 */

import type { AgentRoute, RouteMatch } from './AgentRouter';
import { Logger } from '@modules/monitoring/logs/Logger';

const logger = new Logger();

/**
 * 任务复杂度枚举
 */
export enum TaskComplexity {
  /** 简单任务（如单文件编辑、简短问答） */
  SIMPLE = 'simple',

  /** 中等任务（如小型重构、文档编写） */
  MODERATE = 'moderate',

  /** 复杂任务（如大型重构、跨模块分析） */
  COMPLEX = 'complex',
}

/**
 * 上下文量枚举
 */
export enum ContextSize {
  /** 少量上下文（< 10K tokens） */
  SMALL = 'small',

  /** 中等上下文（10K - 50K tokens） */
  MEDIUM = 'medium',

  /** 大量上下文（> 50K tokens） */
  LARGE = 'large',
}

/**
 * 任务特征矩阵
 * 描述一个任务的量化特征，用于策略匹配
 */
export interface TaskFeature {
  /** 任务类型 */
  taskType: RouteMatch['taskType'];

  /** 任务复杂度 */
  complexity: TaskComplexity;

  /** 上下文量 */
  contextSize: ContextSize;

  /** 所需工具列表（可选，为空时不作为筛选条件） */
  requiredTools?: string[];
}

/**
 * 策略匹配规则
 * 定义某类 TaskFeature 应匹配的 AgentRoute 配置偏好
 */
export interface StrategyRule {
  /** 任务类型匹配（可选，为空时不限制） */
  taskTypes?: RouteMatch['taskType'][];

  /** 复杂度匹配（可选，为空时不限制） */
  complexities?: TaskComplexity[];

  /** 上下文量匹配（可选，为空时不限制） */
  contextSizes?: ContextSize[];

  /** 所需工具匹配（可选，为空时不限制） */
  requiredTools?: string[];

  /** 匹配优先级（数值越大优先级越高） */
  priority: number;

  /** 目标 Agent 配置覆盖 */
  target: {
    /** Agent ID（可选，不指定则只应用配置覆盖） */
    agentId?: string;

    /** 模型偏好（可选） */
    model?: string;

    /** 最大轮次（可选） */
    maxTurns?: number;

    /** 是否沙箱化（可选） */
    isSandboxed?: boolean;
  };
}

/**
 * 策略选择结果
 */
export interface StrategySelection {
  /** 匹配到的路由 */
  route: AgentRoute | null;

  /** 匹配到的规则（如果有） */
  matchedRule?: StrategyRule;

  /** 匹配置信度（0-1） */
  confidence: number;
}

/**
 * 策略选择器
 * 基于任务特征矩阵自动匹配最佳策略
 */
export class StrategySelector {
  private rules: StrategyRule[] = [];
  private defaultRoute: AgentRoute | null = null;

  /**
   * 设置策略规则
   * @param rules 规则列表（按 priority 降序排列）
   */
  setRules(rules: StrategyRule[]): void {
    this.rules = [...rules].sort((a, b) => b.priority - a.priority);
  }

  /**
   * 添加单条策略规则
   */
  addRule(rule: StrategyRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 获取所有策略规则
   */
  getRules(): StrategyRule[] {
    return [...this.rules];
  }

  /**
   * 设置默认路由
   */
  setDefaultRoute(route: AgentRoute): void {
    this.defaultRoute = route;
  }

  /**
   * 基于任务特征选择最佳策略
   * @param feature 任务特征
   * @param availableRoutes 可用路由列表
   * @returns 策略选择结果
   */
  select(
    feature: TaskFeature,
    availableRoutes: AgentRoute[]
  ): StrategySelection {
    // 1. 精确匹配：同时匹配 taskType + complexity
    const exactMatch = this.findBestMatch(feature, availableRoutes, true);
    if (exactMatch.route) {
      logger.info('策略精确匹配成功', {
        agentId: exactMatch.route.agentId,
        taskType: feature.taskType,
        complexity: feature.complexity,
      });
      return exactMatch;
    }

    // 2. 宽松匹配：仅匹配 taskType
    const looseMatch = this.findBestMatch(feature, availableRoutes, false);
    if (looseMatch.route) {
      logger.info('策略宽松匹配成功', {
        agentId: looseMatch.route.agentId,
        taskType: feature.taskType,
      });
      return looseMatch;
    }

    // 3. 使用默认路由
    if (this.defaultRoute) {
      logger.info('使用默认路由', {
        agentId: this.defaultRoute.agentId,
      });
      return {
        route: this.defaultRoute,
        confidence: 0.3,
      };
    }

    // 4. 从可用路由中取第一个作为兜底
    for (const route of availableRoutes) {
      if (route.isDefault) {
        return { route, confidence: 0.2 };
      }
    }

    return { route: availableRoutes[0] || null, confidence: 0.1 };
  }

  /**
   * 分析任务特征（从 RouteMatch 和额外信息）
   * @param match 路由匹配信息
   * @param inputLength 输入文本长度（可选）
   * @param toolCount 工具数量（可选）
   * @returns 任务特征
   */
  analyzeFeature(
    match: RouteMatch,
    inputLength?: number,
    toolCount?: number
  ): TaskFeature {
    const complexity = this.estimateComplexity(match.taskType, inputLength);
    const contextSize = this.estimateContextSize(inputLength);

    return {
      taskType: match.taskType,
      complexity,
      contextSize,
      requiredTools: undefined,
    };
  }

  /**
   * 估算任务复杂度
   */
  private estimateComplexity(
    taskType: RouteMatch['taskType'],
    inputLength?: number
  ): TaskComplexity {
    if (inputLength !== undefined && inputLength > 10000) {
      return TaskComplexity.COMPLEX;
    }
    if (inputLength !== undefined && inputLength > 2000) {
      return TaskComplexity.MODERATE;
    }

    switch (taskType) {
      case 'refactor':
      case 'review':
        return TaskComplexity.MODERATE;
      case 'code':
      case 'test':
        return inputLength !== undefined && inputLength > 5000
          ? TaskComplexity.COMPLEX
          : TaskComplexity.MODERATE;
      case 'chat':
        return TaskComplexity.SIMPLE;
      case 'general':
      default:
        return TaskComplexity.SIMPLE;
    }
  }

  /**
   * 估算上下文量
   */
  private estimateContextSize(inputLength?: number): ContextSize {
    if (inputLength === undefined) {
      return ContextSize.SMALL;
    }
    if (inputLength > 50000) {
      return ContextSize.LARGE;
    }
    if (inputLength > 10000) {
      return ContextSize.MEDIUM;
    }
    return ContextSize.SMALL;
  }

  /**
   * 查找最佳匹配规则
   */
  private findBestMatch(
    feature: TaskFeature,
    availableRoutes: AgentRoute[],
    exact: boolean
  ): StrategySelection {
    for (const rule of this.rules) {
      if (!this.matchesRule(feature, rule, exact)) {
        continue;
      }

      // 找到目标 Agent
      const targetRoute = rule.target.agentId
        ? availableRoutes.find((r) => r.agentId === rule.target.agentId)
        : null;

      if (targetRoute) {
        return {
          route: this.applyOverrides(targetRoute, rule.target),
          matchedRule: rule,
          confidence: exact ? 0.9 : 0.6,
        };
      }
    }

    return { route: null, confidence: 0 };
  }

  /**
   * 检查任务特征是否匹配规则
   */
  private matchesRule(
    feature: TaskFeature,
    rule: StrategyRule,
    exact: boolean
  ): boolean {
    if (rule.taskTypes && !rule.taskTypes.includes(feature.taskType)) {
      return false;
    }

    if (exact) {
      if (
        rule.complexities &&
        !rule.complexities.includes(feature.complexity)
      ) {
        return false;
      }
      if (
        rule.contextSizes &&
        !rule.contextSizes.includes(feature.contextSize)
      ) {
        return false;
      }
    }

    if (rule.requiredTools && feature.requiredTools) {
      const hasAll = rule.requiredTools.every((t) =>
        feature.requiredTools!.includes(t)
      );
      if (!hasAll) {
        return false;
      }
    }

    return true;
  }

  /**
   * 应用配置覆盖
   */
  private applyOverrides(
    route: AgentRoute,
    target: StrategyRule['target']
  ): AgentRoute {
    return {
      ...route,
      ...(target.model ? { model: target.model } : {}),
      ...(target.maxTurns !== undefined ? { maxTurns: target.maxTurns } : {}),
      ...(target.isSandboxed !== undefined
        ? { isSandboxed: target.isSandboxed }
        : {}),
    };
  }
}
