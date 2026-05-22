/**
 * 任务路由器
 * 根据意图和上下文决定任务路由
 */

import type { Intent, RouteDecision, RoutingStrategy } from './types.js';

export class TaskRouterImpl {
  private strategy: RoutingStrategy;
  private fallbackEnabled: boolean;
  private thresholds: { ruleEngine: number; localLLM: number; cloud: number };

  constructor(
    strategy: RoutingStrategy = 'local-first',
    fallbackEnabled: boolean = true,
    thresholds?: { ruleEngine: number; localLLM: number; cloud: number }
  ) {
    this.strategy = strategy;
    this.fallbackEnabled = fallbackEnabled;
    this.thresholds = thresholds || {
      ruleEngine: 0.85,
      localLLM: 0.6,
      cloud: 0,
    };
  }

  route(intent: Intent, context?: any): RouteDecision {
    const { type, confidence } = intent;

    if (confidence < 0.3) {
      return this.createCloudDecision('低置信度，降级到 Cloud');
    }

    if (this.strategy === 'local-first') {
      return this.routeLocalFirst(intent, context);
    }

    switch (type) {
      case 'command':
        return this.routeCommand(intent, context);
      case 'code_generation':
        return this.routeCodeGeneration(intent, context);
      case 'explanation':
        return this.routeExplanation(intent, context);
      case 'simple_qa':
        return this.routeSimpleQA(intent, context);
      case 'skill':
        return this.routeSkill(intent, context);
      case 'mcp':
        return this.routeMCP(intent, context);
      case 'general':
      default:
        return this.routeGeneral(intent, context);
    }
  }

  private routeLocalFirst(intent: Intent, context?: any): RouteDecision {
    const { type, confidence } = intent;
    const { ruleEngine, localLLM } = this.thresholds;

    // ① 高置信度（≥ ruleEngine）→ 本地规则引擎/命令/技能/MCP
    if (confidence >= ruleEngine) {
      switch (type) {
        case 'simple_qa':
          return {
            target: 'rule_engine',
            handler: 'simple_qa',
            reason: '高置信度简单问答',
          };
        case 'command':
          return {
            target: 'rule_engine',
            handler: 'command',
            reason: '高置信度命令',
            fallback: this.createCloudDecision('命令执行失败，降级到 Cloud'),
          };
        case 'skill':
          return {
            target: 'rule_engine',
            handler: 'skill',
            reason: '高置信度技能调用',
          };
        case 'mcp':
          return {
            target: 'rule_engine',
            handler: 'mcp',
            reason: '高置信度 MCP 调用',
          };
      }
    }

    // ② 中等置信度（≥ localLLM）→ 本地 LLM（Ollama）
    if (confidence >= localLLM) {
      switch (type) {
        case 'explanation':
          return {
            target: 'ollama',
            model: 'qwen3:1.8b',
            reason: '本地优先策略：解释类',
            fallback: this.createCloudDecision('Ollama 不可用，降级到 Cloud'),
          };
        case 'code_generation':
          return {
            target: 'ollama',
            model: 'qwen3:1.8b',
            reason: '本地优先策略：代码生成',
            fallback: this.createCloudDecision('Ollama 不可用，降级到 Cloud'),
          };
        case 'general':
          return {
            target: 'ollama',
            model: 'qwen3:1.8b',
            reason: '本地优先策略：通用',
            fallback: this.createCloudDecision('Ollama 不可用，降级到 Cloud'),
          };
      }
    }

    // ③ 低置信度（< localLLM）或未匹配 type → 云端回退
    return {
      target: 'cloud',
      model: 'deepseek-chat',
      reason: '低置信度，降级到 Cloud',
    };
  }

  private routeMCP(intent: Intent, context?: any): RouteDecision {
    return {
      target: 'rule_engine',
      handler: 'mcp',
      reason: 'MCP工具调用由规则引擎处理',
    };
  }

  private routeSkill(intent: Intent, context?: any): RouteDecision {
    return {
      target: 'rule_engine',
      handler: 'skill',
      reason: '技能调用由规则引擎处理',
    };
  }

  private routeCommand(intent: Intent, context?: any): RouteDecision {
    return {
      target: 'rule_engine',
      handler: 'command',
      reason: '命令执行由规则引擎处理',
      fallback: this.createCloudDecision('命令执行失败，降级到 Cloud'),
    };
  }

  private routeCodeGeneration(intent: Intent, context?: any): RouteDecision {
    if (this.strategy === 'ollama-first') {
      return {
        target: 'ollama',
        model: 'qwen3:1.8b',
        reason: 'Ollama 优先策略',
        fallback: this.createCloudDecision('Ollama 不可用，降级到 Cloud'),
      };
    }

    return {
      target: 'cloud',
      model: 'deepseek-chat',
      reason: '代码生成需要强推理能力',
    };
  }

  private routeExplanation(intent: Intent, context?: any): RouteDecision {
    if (this.strategy === 'ollama-first') {
      return {
        target: 'ollama',
        model: 'qwen3:1.8b',
        reason: 'Ollama 优先策略',
        fallback: this.createCloudDecision('Ollama 不可用，降级到 Cloud'),
      };
    }

    return {
      target: 'cloud',
      model: 'deepseek-chat',
      reason: '解释需要知识理解',
    };
  }

  private routeSimpleQA(intent: Intent, context?: any): RouteDecision {
    return {
      target: 'rule_engine',
      handler: 'simple_qa',
      reason: '简单问答由规则引擎处理',
    };
  }

  private routeGeneral(intent: Intent, context?: any): RouteDecision {
    if (context?.inputLength && context.inputLength < 50) {
      return {
        target: 'rule_engine',
        handler: 'general',
        reason: '简短输入由规则引擎处理',
      };
    }

    if (this.strategy === 'local-first') {
      return {
        target: 'ollama',
        model: 'qwen3:1.8b',
        reason: '本地优先策略',
        fallback: this.createCloudDecision('Ollama 不可用，降级到 Cloud'),
      };
    }

    return {
      target: 'cloud',
      model: 'deepseek-chat',
      reason: '通用任务使用 Cloud',
    };
  }

  private createCloudDecision(reason: string): RouteDecision {
    return {
      target: 'cloud',
      model: 'deepseek-chat',
      reason,
    };
  }

  setStrategy(strategy: RoutingStrategy): void {
    this.strategy = strategy;
  }

  getStrategy(): RoutingStrategy {
    return this.strategy;
  }

  setFallbackEnabled(enabled: boolean): void {
    this.fallbackEnabled = enabled;
  }

  isFallbackEnabled(): boolean {
    return this.fallbackEnabled;
  }

  setThresholds(thresholds: {
    ruleEngine: number;
    localLLM: number;
    cloud: number;
  }): void {
    this.thresholds = thresholds;
  }

  getThresholds(): { ruleEngine: number; localLLM: number; cloud: number } {
    return { ...this.thresholds };
  }
}

export function createTaskRouter(
  strategy?: RoutingStrategy,
  fallbackEnabled?: boolean,
  thresholds?: { ruleEngine: number; localLLM: number; cloud: number }
): TaskRouterImpl {
  return new TaskRouterImpl(strategy, fallbackEnabled, thresholds);
}
