/**
 * 主动式规则建议引擎
 * 持续监听审计事件，自动检测模式并生成可执行的治理规则建议
 * 弥补 IntelligentGovernanceAnalyzer 仅输出文本建议、不生成可执行规则的差距
 */

import { EventEmitter } from 'events';
import { getLogger } from '@modules/monitoring';
import {
  governanceAuditService,
  type AuditEvent,
} from './managers/GovernanceAuditService';
import {
  governanceStrategyManager,
  type GovernanceRule,
  type GovernanceStrategy,
} from './managers/GovernanceStrategyManager';

const logger = getLogger('governance:ruleSuggestionEngine');

/**
 * 建议来源模式类型
 */
export type SuggestionPatternType =
  | 'repeated_denial'
  | 'frequent_violation'
  | 'performance_regression'
  | 'tool_usage_anomaly'
  | 'permission_escalation'
  | 'compliance_gap';

/**
 * 建议状态
 */
export type SuggestionStatus =
  | 'pending'
  | 'acknowledged'
  | 'applied'
  | 'dismissed';

/**
 * 检测到的模式
 */
export interface DetectedPattern {
  patternType: SuggestionPatternType;
  targetTool: string;
  targetAction?: string;
  occurrenceCount: number;
  timeWindowMs: number;
  severity: 'low' | 'medium' | 'high';
  firstDetectedAt: number;
  lastDetectedAt: number;
  sampleEvents: AuditEvent[];
}

/**
 * 规则建议
 */
export interface RuleSuggestion {
  id: string;
  patternType: SuggestionPatternType;
  title: string;
  description: string;
  suggestedRule: GovernanceRule;
  targetStrategyId?: string;
  confidence: number;
  severity: 'low' | 'medium' | 'high';
  status: SuggestionStatus;
  detectedPattern: DetectedPattern;
  createdAt: number;
  resolvedAt?: number;
}

/**
 * 规则建议查询选项
 */
export interface SuggestionQueryOptions {
  status?: SuggestionStatus;
  patternType?: SuggestionPatternType;
  minConfidence?: number;
  limit?: number;
}

/**
 * 规则建议引擎配置
 */
export interface RuleSuggestionEngineConfig {
  enableAutoDetection: boolean;
  patternWindowMs: number;
  denialThreshold: number;
  violationThreshold: number;
  performanceThresholdMs: number;
  minConfidence: number;
  maxSuggestions: number;
}

const DEFAULT_CONFIG: RuleSuggestionEngineConfig = {
  enableAutoDetection: true,
  patternWindowMs: 3600000,
  denialThreshold: 3,
  violationThreshold: 3,
  performanceThresholdMs: 2000,
  minConfidence: 0.3,
  maxSuggestions: 50,
};

/**
 * 主动式规则建议引擎
 */
export class RuleSuggestionEngine extends EventEmitter {
  private config: RuleSuggestionEngineConfig;
  private suggestions: Map<string, RuleSuggestion> = new Map();
  private eventBuffer: AuditEvent[] = [];
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private eventListener: ((event: AuditEvent) => void) | null = null;

  constructor(config?: Partial<RuleSuggestionEngineConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.enableAutoDetection) {
      this.startListening();
    }
  }

  /**
   * 启动审计事件监听
   */
  startListening(): void {
    if (this.eventListener) return;

    this.eventListener = (event: AuditEvent) => {
      this.eventBuffer.push(event);
      this.detectPatterns(event);
    };

    governanceAuditService.on('auditEvent', this.eventListener);

    this.cleanupTimer = setInterval(() => {
      const before = this.eventBuffer.length;
      this.pruneExpiredEvents();
      logger.debug('规则建议事件缓冲清理完成', {
        removed: before - this.eventBuffer.length,
        remaining: this.eventBuffer.length,
      });
    }, 60000);
  }

  /**
   * 停止审计事件监听
   */
  stopListening(): void {
    if (this.eventListener) {
      governanceAuditService.off('auditEvent', this.eventListener);
      this.eventListener = null;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 从事件中检测模式
   */
  private detectPatterns(event: AuditEvent): void {
    const toolName = event.toolName;
    const eventType = event.type;

    if (eventType === 'tool_failed' || eventType === 'permission_check') {
      this.detectRepeatedDenial(toolName);
    }

    if (eventType === 'sandbox_violation') {
      this.detectFrequentViolation(toolName);
    }
  }

  /**
   * 检测重复拒绝模式
   */
  private detectRepeatedDenial(toolName: string): void {
    const now = Date.now();
    const windowStart = now - this.config.patternWindowMs;

    const recentDenials = this.eventBuffer.filter(
      (e) =>
        e.toolName === toolName &&
        (e.type === 'tool_failed' || e.type === 'permission_check') &&
        e.timestamp.getTime() >= windowStart
    );

    if (recentDenials.length >= this.config.denialThreshold) {
      const existingSuggestion = this.findExistingSuggestion(
        'repeated_denial',
        toolName
      );

      if (existingSuggestion) {
        existingSuggestion.detectedPattern.occurrenceCount =
          recentDenials.length;
        existingSuggestion.detectedPattern.lastDetectedAt = now;
        existingSuggestion.confidence = this.calculateConfidence(
          recentDenials.length,
          this.config.denialThreshold
        );
        return;
      }

      if (this.suggestions.size >= this.config.maxSuggestions) return;

      const suggestion = this.createDenialSuggestion(toolName, recentDenials);
      this.suggestions.set(suggestion.id, suggestion);
      this.emit('suggestion', suggestion);
      logger.info(
        `检测到重复拒绝模式: ${toolName} (${recentDenials.length}次)`
      );
    }
  }

  /**
   * 检测频繁违规模式
   */
  private detectFrequentViolation(toolName: string): void {
    const now = Date.now();
    const windowStart = now - this.config.patternWindowMs;

    const recentViolations = this.eventBuffer.filter(
      (e) =>
        e.toolName === toolName &&
        e.type === 'sandbox_violation' &&
        e.timestamp.getTime() >= windowStart
    );

    if (recentViolations.length >= this.config.violationThreshold) {
      const existingSuggestion = this.findExistingSuggestion(
        'frequent_violation',
        toolName
      );

      if (existingSuggestion) {
        existingSuggestion.detectedPattern.occurrenceCount =
          recentViolations.length;
        existingSuggestion.detectedPattern.lastDetectedAt = now;
        existingSuggestion.confidence = this.calculateConfidence(
          recentViolations.length,
          this.config.violationThreshold
        );
        return;
      }

      if (this.suggestions.size >= this.config.maxSuggestions) return;

      const suggestion = this.createViolationSuggestion(
        toolName,
        recentViolations
      );
      this.suggestions.set(suggestion.id, suggestion);
      this.emit('suggestion', suggestion);
      logger.info(
        `检测到频繁违规模式: ${toolName} (${recentViolations.length}次)`
      );
    }
  }

  /**
   * 查找已存在的同类型建议
   */
  private findExistingSuggestion(
    patternType: SuggestionPatternType,
    toolName: string
  ): RuleSuggestion | undefined {
    for (const suggestion of this.suggestions.values()) {
      if (
        suggestion.patternType === patternType &&
        suggestion.detectedPattern.targetTool === toolName &&
        suggestion.status === 'pending'
      ) {
        return suggestion;
      }
    }
    return undefined;
  }

  /**
   * 计算置信度
   */
  private calculateConfidence(
    occurrenceCount: number,
    threshold: number
  ): number {
    const ratio = occurrenceCount / threshold;
    return Math.min(1.0, 0.3 + ratio * 0.2);
  }

  /**
   * 创建拒绝模式建议
   */
  private createDenialSuggestion(
    toolName: string,
    events: AuditEvent[]
  ): RuleSuggestion {
    const now = Date.now();
    const suggestionId = `suggest-deny-${toolName.toLowerCase()}-${now}`;

    const rule: GovernanceRule = {
      id: `auto-${suggestionId}`,
      type: 'permission',
      action: 'deny',
      target: toolName,
      priority: 80,
      description: `自动建议：${toolName} 在 ${this.config.patternWindowMs / 60000} 分钟内被拒绝 ${events.length} 次`,
    };

    const severity =
      events.length >= this.config.denialThreshold * 2
        ? 'high'
        : events.length >= this.config.denialThreshold * 1.5
          ? 'medium'
          : 'low';

    const firstEvent = events.reduce(
      (earliest, e) =>
        e.timestamp.getTime() < earliest.timestamp.getTime() ? e : earliest,
      events[0]
    );
    const lastEvent = events.reduce(
      (latest, e) =>
        e.timestamp.getTime() > latest.timestamp.getTime() ? e : latest,
      events[0]
    );

    return {
      id: suggestionId,
      patternType: 'repeated_denial',
      title: `建议限制工具: ${toolName}`,
      description: `${toolName} 在过去 ${this.config.patternWindowMs / 60000} 分钟内被拒绝 ${events.length} 次，建议添加拒绝规则`,
      suggestedRule: rule,
      confidence: this.calculateConfidence(
        events.length,
        this.config.denialThreshold
      ),
      severity,
      status: 'pending',
      detectedPattern: {
        patternType: 'repeated_denial',
        targetTool: toolName,
        occurrenceCount: events.length,
        timeWindowMs: this.config.patternWindowMs,
        severity,
        firstDetectedAt: firstEvent.timestamp.getTime(),
        lastDetectedAt: lastEvent.timestamp.getTime(),
        sampleEvents: events.slice(-3),
      },
      createdAt: now,
    };
  }

  /**
   * 创建违规模式建议
   */
  private createViolationSuggestion(
    toolName: string,
    events: AuditEvent[]
  ): RuleSuggestion {
    const now = Date.now();
    const suggestionId = `suggest-restrict-${toolName.toLowerCase()}-${now}`;

    const rule: GovernanceRule = {
      id: `auto-${suggestionId}`,
      type: 'sandbox',
      action: 'deny',
      target: toolName,
      priority: 90,
      description: `自动建议：${toolName} 在 ${this.config.patternWindowMs / 60000} 分钟内违规 ${events.length} 次，建议沙箱限制`,
    };

    const severity =
      events.length >= this.config.violationThreshold * 2
        ? 'high'
        : events.length >= this.config.violationThreshold * 1.5
          ? 'medium'
          : 'low';

    const firstEvent = events.reduce(
      (earliest, e) =>
        e.timestamp.getTime() < earliest.timestamp.getTime() ? e : earliest,
      events[0]
    );
    const lastEvent = events.reduce(
      (latest, e) =>
        e.timestamp.getTime() > latest.timestamp.getTime() ? e : latest,
      events[0]
    );

    return {
      id: suggestionId,
      patternType: 'frequent_violation',
      title: `建议沙箱限制: ${toolName}`,
      description: `${toolName} 在过去 ${this.config.patternWindowMs / 60000} 分钟内违规 ${events.length} 次，建议添加沙箱限制规则`,
      suggestedRule: rule,
      confidence: this.calculateConfidence(
        events.length,
        this.config.violationThreshold
      ),
      severity,
      status: 'pending',
      detectedPattern: {
        patternType: 'frequent_violation',
        targetTool: toolName,
        occurrenceCount: events.length,
        timeWindowMs: this.config.patternWindowMs,
        severity,
        firstDetectedAt: firstEvent.timestamp.getTime(),
        lastDetectedAt: lastEvent.timestamp.getTime(),
        sampleEvents: events.slice(-3),
      },
      createdAt: now,
    };
  }

  /**
   * 清理过期事件
   */
  private pruneExpiredEvents(): void {
    const cutoff = Date.now() - this.config.patternWindowMs;

    this.eventBuffer = this.eventBuffer.filter(
      (e) => e.timestamp.getTime() >= cutoff
    );
  }

  /**
   * 获取所有建议
   */
  getSuggestions(options?: SuggestionQueryOptions): RuleSuggestion[] {
    let result = Array.from(this.suggestions.values());

    if (options?.status) {
      result = result.filter((s) => s.status === options.status);
    }

    if (options?.patternType) {
      result = result.filter((s) => s.patternType === options.patternType);
    }

    if (options?.minConfidence !== undefined) {
      result = result.filter((s) => s.confidence >= options.minConfidence!);
    }

    result.sort((a, b) => b.confidence - a.confidence);

    if (options?.limit && options.limit > 0) {
      result = result.slice(0, options.limit);
    }

    return result;
  }

  /**
   * 标记建议为已确认
   */
  acknowledgeSuggestion(suggestionId: string): boolean {
    const suggestion = this.suggestions.get(suggestionId);
    if (!suggestion || suggestion.status !== 'pending') return false;

    suggestion.status = 'acknowledged';
    this.emit('acknowledged', suggestion);
    return true;
  }

  /**
   * 应用建议到策略管理器
   */
  applySuggestion(suggestionId: string, targetStrategyId?: string): boolean {
    const suggestion = this.suggestions.get(suggestionId);
    if (!suggestion || suggestion.status === 'applied') return false;

    const strategyId = targetStrategyId || suggestion.targetStrategyId;

    let targetStrategy: GovernanceStrategy | undefined;

    if (strategyId) {
      targetStrategy = governanceStrategyManager.getStrategy(strategyId);
    }

    if (!targetStrategy) {
      targetStrategy = governanceStrategyManager.getActiveStrategy();
    }

    if (!targetStrategy) return false;

    const existingRule = targetStrategy.rules.find(
      (r) =>
        r.target === suggestion.suggestedRule.target &&
        r.type === suggestion.suggestedRule.type
    );

    if (existingRule) {
      logger.info(
        `规则已存在，跳过应用: ${suggestion.suggestedRule.target} (${suggestion.suggestedRule.type})`
      );
      suggestion.status = 'applied';
      suggestion.resolvedAt = Date.now();
      return true;
    }

    const updatedRules = [...targetStrategy.rules, suggestion.suggestedRule];
    const updated = governanceStrategyManager.updateStrategy(
      targetStrategy.id,
      {
        rules: updatedRules,
      }
    );

    if (!updated) return false;

    suggestion.status = 'applied';
    suggestion.resolvedAt = Date.now();
    suggestion.targetStrategyId = targetStrategy.id;

    this.emit('applied', suggestion);
    logger.info(`建议已应用: ${suggestion.id} → 策略 ${targetStrategy.name}`);

    return true;
  }

  /**
   * 标记建议为已忽略
   */
  dismissSuggestion(suggestionId: string): boolean {
    const suggestion = this.suggestions.get(suggestionId);
    if (!suggestion || suggestion.status === 'dismissed') return false;

    suggestion.status = 'dismissed';
    suggestion.resolvedAt = Date.now();
    this.emit('dismissed', suggestion);
    return true;
  }

  /**
   * 获取配置
   */
  getConfig(): RuleSuggestionEngineConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<RuleSuggestionEngineConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 获取建议统计
   */
  getSuggestionStats(): {
    total: number;
    pending: number;
    acknowledged: number;
    applied: number;
    dismissed: number;
  } {
    const suggestions = Array.from(this.suggestions.values());
    return {
      total: suggestions.length,
      pending: suggestions.filter((s) => s.status === 'pending').length,
      acknowledged: suggestions.filter((s) => s.status === 'acknowledged')
        .length,
      applied: suggestions.filter((s) => s.status === 'applied').length,
      dismissed: suggestions.filter((s) => s.status === 'dismissed').length,
    };
  }
}

export const ruleSuggestionEngine = new RuleSuggestionEngine();
