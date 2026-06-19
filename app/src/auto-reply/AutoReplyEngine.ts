import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

/**
 * AutoReplyEngine 自动回复引擎
 * P2 — 对标 OpenClaw 的自动回复系统
 */

/**
 * 回复规则
 */
export interface ReplyRule {
  id: string;
  name: string;
  pattern: RegExp | string;
  response: string | ((context: ReplyContext) => string | Promise<string>);
  priority: number;
  channel?: string;
  enabled: boolean;
  cooldown?: number;
}

/**
 * 回复上下文
 */
export interface ReplyContext {
  message: string;
  channel: string;
  sender: string;
  timestamp: number;
  matchedRule: ReplyRule;
  metadata?: Record<string, unknown>;
}

/**
 * 回复结果
 */
export interface ReplyResult {
  handled: boolean;
  response?: string;
  rule?: ReplyRule;
  latency: number;
}

/**
 * 自动回复配置
 */
export interface AutoReplyConfig {
  enabled: boolean;
  defaultCooldown: number;
  maxRules: number;
}

/**
 * 自动回复引擎
 */
export class AutoReplyEngine {
  private rules: Map<string, ReplyRule> = new Map();
  private cooldowns: Map<string, number> = new Map();
  private config: AutoReplyConfig;
  private stats: { totalProcessed: number; matched: number; failed: number } = {
    totalProcessed: 0,
    matched: 0,
    failed: 0,
  };

  constructor(config?: Partial<AutoReplyConfig>) {
    this.config = {
      enabled: config?.enabled !== false,
      defaultCooldown: config?.defaultCooldown || 5000,
      maxRules: config?.maxRules || 100,
    };
  }

  /**
   * 注册规则
   */
  registerRule(rule: Omit<ReplyRule, 'id'>): ReplyRule {
    const newRule: ReplyRule = {
      ...rule,
      id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };

    if (this.rules.size >= this.config.maxRules) {
      throw new AppError(
        `达到最大规则数: ${this.config.maxRules}`,
        ErrorCategory.RESOURCE,
        ErrorSeverity.HIGH,
        'RESOURCE_EXHAUSTED',
        { current: this.rules.size, max: this.config.maxRules }
      );
    }

    this.rules.set(newRule.id, newRule);

    return newRule;
  }

  /**
   * 处理消息
   */
  async process(
    message: string,
    channel: string,
    sender: string
  ): Promise<ReplyResult> {
    const startTime = Date.now();

    this.stats.totalProcessed++;

    if (!this.config.enabled) {
      return { handled: false, latency: Date.now() - startTime };
    }

    const matchedRules = Array.from(this.rules.values())
      .filter((r) => r.enabled && this.matchRule(r, message))
      .sort((a, b) => b.priority - a.priority);

    for (const rule of matchedRules) {
      if (this.isOnCooldown(rule.id)) continue;

      const context: ReplyContext = {
        message,
        channel,
        sender,
        timestamp: Date.now(),
        matchedRule: rule,
      };

      try {
        const response =
          typeof rule.response === 'function'
            ? await Promise.resolve(rule.response(context))
            : rule.response;

        this.setCooldown(rule.id, rule.cooldown);
        this.stats.matched++;

        return {
          handled: true,
          response,
          rule,
          latency: Date.now() - startTime,
        };
      } catch {
        this.stats.failed++;
      }
    }

    return { handled: false, latency: Date.now() - startTime };
  }

  /**
   * 启用/禁用规则
   */
  setRuleEnabled(id: string, enabled: boolean): boolean {
    const rule = this.rules.get(id);

    if (!rule) return false;

    rule.enabled = enabled;

    return true;
  }

  /**
   * 删除规则
   */
  deleteRule(id: string): boolean {
    return this.rules.delete(id);
  }

  /**
   * 获取所有规则
   */
  getAllRules(): ReplyRule[] {
    return Array.from(this.rules.values()).sort(
      (a, b) => b.priority - a.priority
    );
  }

  /**
   * 获取统计
   */
  getStats() {
    return { ...this.stats, ruleCount: this.rules.size };
  }

  /**
   * 匹配规则
   */
  private matchRule(rule: ReplyRule, message: string): boolean {
    if (rule.pattern instanceof RegExp) {
      return rule.pattern.test(message);
    }

    if (typeof rule.pattern === 'string') {
      return message.includes(rule.pattern);
    }

    return false;
  }

  /**
   * 检查冷却
   */
  private isOnCooldown(ruleId: string): boolean {
    const until = this.cooldowns.get(ruleId);

    if (!until) return false;

    if (Date.now() >= until) {
      this.cooldowns.delete(ruleId);

      return false;
    }

    return true;
  }

  /**
   * 设置冷却
   */
  private setCooldown(ruleId: string, cooldown?: number): void {
    const duration = cooldown || this.config.defaultCooldown;

    this.cooldowns.set(ruleId, Date.now() + duration);
  }
}

export const autoReplyEngine = new AutoReplyEngine();
