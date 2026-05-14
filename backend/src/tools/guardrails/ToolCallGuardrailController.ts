/**
 * 工具调用护栏控制器
 * 对标 Hermes agent/tool_guardrails.py
 * 在工具执行前进行运行时护栏决策
 */
import type { ToolUseContext, ToolParam } from '../../tools/types';
import {
  GuardrailDecision,
  createAllowDecision,
  createWarnDecision,
  createBlockDecision,
  createConfirmDecision,
  type GuardrailAction,
} from './GuardrailDecision';
import {
  GuardrailRule,
  DEFAULT_GUARDRAIL_RULES,
  getEnabledRules,
} from './GuardrailRules';

/**
 * 护栏控制结果
 */
export interface GuardrailResult {
  decision: GuardrailDecision;
  matchedRules: string[];
  executionTimeMs: number;
}

/**
 * 护栏配置
 */
export interface GuardrailConfig {
  enabled: boolean;
  strictMode: boolean;
  maxRulesToMatch: number;
  customRules: GuardrailRule[];
  allowlist: string[];
  blocklist: string[];
}

/**
 * 默认护栏配置
 */
const DEFAULT_CONFIG: GuardrailConfig = {
  enabled: true,
  strictMode: false,
  maxRulesToMatch: 5,
  customRules: [],
  allowlist: [],
  blocklist: [],
};

/**
 * 工具调用护栏控制器
 */
export class ToolCallGuardrailController {
  private config: GuardrailConfig;
  private rules: GuardrailRule[];
  private decisionHistory: GuardrailDecision[] = [];
  private maxHistory: number = 500;

  /**
   * 构造函数
   * @param config 护栏配置
   * @param rules 护栏规则
   */
  constructor(config?: Partial<GuardrailConfig>, rules?: GuardrailRule[]) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rules = rules || [...DEFAULT_GUARDRAIL_RULES];
  }

  /**
   * 检查工具调用是否允许执行
   * @param toolName 工具名称
   * @param params 工具参数
   * @param context 工具使用上下文
   * @returns 护栏控制结果
   */
  check(
    toolName: string,
    params: Record<string, unknown>,
    context?: ToolUseContext
  ): GuardrailResult {
    const startTime = Date.now();

    if (!this.config.enabled) {
      const decision = createAllowDecision(context);
      this.addHistory(decision);

      return {
        decision,
        matchedRules: [],
        executionTimeMs: Date.now() - startTime,
      };
    }

    if (this.config.allowlist.includes(toolName)) {
      const decision = createAllowDecision(context);
      this.addHistory(decision);

      return {
        decision,
        matchedRules: [],
        executionTimeMs: Date.now() - startTime,
      };
    }

    if (this.config.blocklist.includes(toolName)) {
      const decision = createBlockDecision(
        `工具 "${toolName}" 在黑名单中`,
        'blocklist',
        context
      );
      this.addHistory(decision);

      return {
        decision,
        matchedRules: ['blocklist'],
        executionTimeMs: Date.now() - startTime,
      };
    }

    const enabledRules = getEnabledRules(this.rules);
    const matchedRules: string[] = [];

    for (const rule of enabledRules) {
      if (matchedRules.length >= this.config.maxRulesToMatch) {
        break;
      }

      if (!this.matchesCondition(rule, toolName, params)) {
        continue;
      }

      matchedRules.push(rule.name);

      let decision: GuardrailDecision;

      switch (rule.action) {
        case 'block':
          decision = createBlockDecision(rule.description, rule.name, context);
          this.addHistory(decision);

          return {
            decision,
            matchedRules,
            executionTimeMs: Date.now() - startTime,
          };
        case 'confirm':
          if (this.config.strictMode) {
            decision = createConfirmDecision(
              rule.description,
              rule.name,
              context
            );
            this.addHistory(decision);

            return {
              decision,
              matchedRules,
              executionTimeMs: Date.now() - startTime,
            };
          }
          decision = createWarnDecision(rule.description, rule.name, context);
          break;
        case 'warn':
          decision = createWarnDecision(rule.description, rule.name, context);
          break;
        default:
          continue;
      }

      this.addHistory(decision);
    }

    const decision = createAllowDecision(context);
    this.addHistory(decision);

    return {
      decision,
      matchedRules,
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * 检查条件是否匹配
   * @param rule 规则
   * @param toolName 工具名称
   * @param params 工具参数
   * @returns 是否匹配
   */
  private matchesCondition(
    rule: GuardrailRule,
    toolName: string,
    params: Record<string, unknown>
  ): boolean {
    const { condition } = rule;

    const toolPattern = new RegExp(condition.toolNamePattern, 'i');
    if (!toolPattern.test(toolName)) {
      return false;
    }

    if (condition.paramKeyPattern || condition.paramValuePattern) {
      const paramsStr = JSON.stringify(params);

      if (condition.paramKeyPattern && condition.paramValuePattern) {
        const keyPattern = new RegExp(condition.paramKeyPattern, 'i');
        const valuePattern = new RegExp(condition.paramValuePattern, 'i');

        for (const [key, value] of Object.entries(params)) {
          if (keyPattern.test(key) && valuePattern.test(String(value))) {
            return true;
          }
        }

        return false;
      }

      if (condition.paramValuePattern) {
        const valuePattern = new RegExp(condition.paramValuePattern, 'i');

        return valuePattern.test(paramsStr);
      }

      if (condition.paramKeyPattern) {
        const keyPattern = new RegExp(condition.paramKeyPattern, 'i');

        return Object.keys(params).some((k) => keyPattern.test(k));
      }
    }

    return true;
  }

  /**
   * 添加自定义规则
   * @param rule 规则
   */
  addRule(rule: GuardrailRule): void {
    this.rules.push(rule);
  }

  /**
   * 移除规则
   * @param ruleName 规则名称
   */
  removeRule(ruleName: string): void {
    this.rules = this.rules.filter((r) => r.name !== ruleName);
  }

  /**
   * 更新配置
   * @param config 配置
   */
  updateConfig(config: Partial<GuardrailConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取配置
   */
  getConfig(): GuardrailConfig {
    return { ...this.config };
  }

  /**
   * 获取所有规则
   */
  getRules(): GuardrailRule[] {
    return [...this.rules];
  }

  /**
   * 获取决策历史
   * @param limit 最大条数
   */
  getHistory(limit?: number): GuardrailDecision[] {
    const sorted = [...this.decisionHistory].sort(
      (a, b) => b.timestamp - a.timestamp
    );

    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * 添加决策到历史
   */
  private addHistory(decision: GuardrailDecision): void {
    this.decisionHistory.push(decision);

    if (this.decisionHistory.length > this.maxHistory) {
      this.decisionHistory = this.decisionHistory.slice(-this.maxHistory);
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    allowed: number;
    warned: number;
    blocked: number;
    confirmed: number;
  } {
    const stats = { allowed: 0, warned: 0, blocked: 0, confirmed: 0 };

    for (const decision of this.decisionHistory) {
      if (decision.action === 'allow') stats.allowed++;
      else if (decision.action === 'warn') stats.warned++;
      else if (decision.action === 'block') stats.blocked++;
      else if (decision.action === 'confirm') stats.confirmed++;
    }

    return stats;
  }

  /**
   * 清除历史
   */
  clearHistory(): void {
    this.decisionHistory = [];
  }
}

/**
 * 全局护栏控制器
 */
let globalController: ToolCallGuardrailController | null = null;

/**
 * 获取全局工具调用护栏控制器
 */
export function getToolCallGuardrailController(): ToolCallGuardrailController {
  if (!globalController) {
    globalController = new ToolCallGuardrailController();
  }

  return globalController;
}

/**
 * 重置全局护栏控制器
 */
export function resetToolCallGuardrailController(): void {
  globalController = null;
}
