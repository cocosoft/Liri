import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { resolveDataSubDir } from '@modules/core';

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

/** pattern 的持久化结构（S2：RegExp 无法直接 JSON 序列化，落盘用此结构） */
export interface StoredPattern {
  type: 'regexp' | 'substring';
  value: string;
  flags?: string;
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
  /** 规则持久化文件路径（构造时传入则启用落盘） */
  private storagePath: string | null = null;

  constructor(config?: Partial<AutoReplyConfig>, storagePath?: string) {
    this.config = {
      enabled: config?.enabled !== false,
      defaultCooldown: config?.defaultCooldown || 5000,
      maxRules: config?.maxRules || 100,
    };
    if (storagePath) {
      this.storagePath = storagePath;
      this.loadFromStorage();
    }
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
    this.persist();

    return newRule;
  }

  /**
   * 更新规则（整体更新非 id 字段）
   */
  updateRule(
    id: string,
    updates: Partial<Omit<ReplyRule, 'id'>>
  ): ReplyRule | null {
    const existing = this.rules.get(id);
    if (!existing) return null;

    const updated: ReplyRule = { ...existing, ...updates };
    this.rules.set(id, updated);
    this.persist();
    return updated;
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
        void handleError(new Error('process'), {
          module: 'auto-reply:engine',
          action: 'process',
        });
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
    this.persist();

    return true;
  }

  /**
   * 删除规则
   */
  deleteRule(id: string): boolean {
    const deleted = this.rules.delete(id);
    if (deleted) this.persist();
    return deleted;
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

  // ─── 规则持久化（S2：文件 JSON，参照 permissions/tool_rules.json 模式）───

  /** pattern 的落盘结构（RegExp 无法直接 JSON 序列化） */
  private static serializePattern(p: RegExp | string): StoredPattern {
    if (p instanceof RegExp) {
      return { type: 'regexp', value: p.source, flags: p.flags };
    }
    return { type: 'substring', value: p };
  }

  private static deserializePattern(p: StoredPattern): RegExp | string {
    if (p.type === 'regexp') {
      return new RegExp(p.value, p.flags ?? '');
    }
    return p.value;
  }

  private persist(): void {
    if (!this.storagePath) return;
    try {
      const data = Array.from(this.rules.values()).map((r) => ({
        id: r.id,
        name: r.name,
        pattern: AutoReplyEngine.serializePattern(r.pattern),
        response: typeof r.response === 'function' ? '' : r.response,
        priority: r.priority,
        channel: r.channel,
        enabled: r.enabled,
        cooldown: r.cooldown,
      }));
      mkdirSync(dirname(this.storagePath), { recursive: true });
      writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      // 落盘失败不影响内存规则，仅上报
      void handleError(e, { module: 'auto-reply:engine', action: 'persist' });
    }
  }

  private loadFromStorage(): void {
    if (!this.storagePath || !existsSync(this.storagePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.storagePath, 'utf-8')) as Array<{
        id: string;
        name: string;
        pattern: StoredPattern;
        response: string;
        priority: number;
        channel?: string;
        enabled: boolean;
        cooldown?: number;
      }>;
      for (const r of raw) {
        this.rules.set(r.id, {
          id: r.id,
          name: r.name,
          pattern: AutoReplyEngine.deserializePattern(r.pattern),
          response: r.response,
          priority: r.priority,
          channel: r.channel,
          enabled: r.enabled,
          cooldown: r.cooldown,
        });
      }
    } catch (e) {
      void handleError(e, { module: 'auto-reply:engine', action: 'load' });
    }
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

export const autoReplyEngine = new AutoReplyEngine(
  undefined,
  join(resolveDataSubDir('auto-reply'), 'rules.json')
);
