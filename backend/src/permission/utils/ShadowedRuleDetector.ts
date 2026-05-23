/**
 * 影子规则检测器
 * 检测被覆盖的权限规则
 * 参考CC源码 cc_code/backend/utils/permissions/shadowedRuleDetection.ts 实现
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });
import { PermissionBehavior } from '../types/PermissionRule.js';
import type { PermissionRule } from '../types/PermissionRule.js';

/**
 * 影子规则信息
 */
export interface ShadowedRuleInfo {
  /** 被覆盖的规则 */
  shadowedRule: PermissionRule;
  /** 覆盖它的规则 */
  shadowingRule: PermissionRule;
  /** 覆盖原因 */
  reason: string;
  /** 覆盖位置索引 */
  shadowingIndex: number;
  /** 严重程度 */
  severity: 'warning' | 'error';
}

/**
 * 影子规则检测结果
 */
export interface ShadowedRuleDetectionResult {
  /** 检测到的影子规则 */
  shadowedRules: ShadowedRuleInfo[];
  /** 总规则数 */
  totalRules: number;
  /** 影子规则数量 */
  shadowedCount: number;
  /** 是否有效 */
  isValid: boolean;
  /** 建议 */
  suggestions: string[];
}

/**
 * 影子规则检测器
 */
export class ShadowedRuleDetector {
  /**
   * 检测影子规则
   */
  detect(rules: PermissionRule[]): ShadowedRuleDetectionResult {
    const shadowedRules: ShadowedRuleInfo[] = [];

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];

      for (let j = 0; j < i; j++) {
        const earlierRule = rules[j];

        if (this.doesShadow(earlierRule, rule)) {
          shadowedRules.push({
            shadowedRule: rule,
            shadowingRule: earlierRule,
            reason: this.getShadowReason(earlierRule, rule),
            shadowingIndex: j,
            severity:
              earlierRule.behavior === PermissionBehavior.DENY
                ? 'error'
                : 'warning',
          });
        }
      }
    }

    const suggestions = this.generateSuggestions(shadowedRules);

    return {
      shadowedRules,
      totalRules: rules.length,
      shadowedCount: shadowedRules.length,
      isValid: shadowedRules.filter((s) => s.severity === 'error').length === 0,
      suggestions,
    };
  }

  /**
   * 检测一个规则是否覆盖另一个
   */
  private doesShadow(
    shadowing: PermissionRule,
    shadowed: PermissionRule
  ): boolean {
    if (
      shadowing.toolName !== shadowed.toolName &&
      shadowing.toolName !== '*'
    ) {
      return false;
    }

    if (shadowing.behavior === shadowed.behavior) {
      return false;
    }

    if (
      shadowing.toolName === '*' &&
      shadowing.behavior !== shadowed.behavior
    ) {
      return true;
    }

    if (
      this.isPatternBroader(shadowing.contentPattern, shadowed.contentPattern)
    ) {
      return true;
    }

    return false;
  }

  /**
   * 检查内容模式是否更宽泛
   */
  private isPatternBroader(
    shadowingPattern: string | undefined,
    shadowedPattern: string | undefined
  ): boolean {
    if (!shadowingPattern && !shadowedPattern) {
      return false;
    }

    if (shadowingPattern && !shadowedPattern) {
      return true;
    }

    if (shadowingPattern && shadowedPattern) {
      if (shadowingPattern.includes('*') && !shadowedPattern.includes('*')) {
        return true;
      }

      if (shadowingPattern.length < shadowedPattern.length) {
        return true;
      }
    }

    return false;
  }

  /**
   * 获取覆盖原因
   */
  private getShadowReason(
    shadowing: PermissionRule,
    shadowed: PermissionRule
  ): string {
    const reasons: string[] = [];

    if (shadowing.toolName === '*') {
      reasons.push(`shadowing rule applies to all tools (toolName='*')`);
    }

    if (!shadowing.contentPattern && shadowed.contentPattern) {
      reasons.push(
        'shadowing rule has no content pattern (matches all inputs)'
      );
    }

    if (shadowing.contentPattern && shadowed.contentPattern) {
      if (
        shadowing.contentPattern.includes('*') &&
        !shadowed.contentPattern.includes('*')
      ) {
        reasons.push('shadowing rule uses wildcard pattern');
      }
    }

    reasons.push(
      `shadowing behavior (${shadowing.behavior}) takes precedence over shadowed behavior (${shadowed.behavior})`
    );

    return reasons.join('; ');
  }

  /**
   * 生成建议
   */
  private generateSuggestions(shadowedRules: ShadowedRuleInfo[]): string[] {
    const suggestions: string[] = [];

    if (shadowedRules.length === 0) {
      return ['No shadowed rules detected. All rules are effective.'];
    }

    suggestions.push(
      `Found ${shadowedRules.length} shadowed rule(s). Consider removing or reordering.`
    );

    const errors = shadowedRules.filter((s) => s.severity === 'error');
    const warnings = shadowedRules.filter((s) => s.severity === 'warning');

    if (errors.length > 0) {
      suggestions.push(
        `ERROR: ${errors.length} rule(s) are completely ineffective due to being blocked by earlier rules.`
      );
      for (const shadow of errors.slice(0, 3)) {
        suggestions.push(
          `  - Rule '${shadow.shadowedRule.id}' at index ${shadow.shadowedRule.priority} is shadowed by '${shadow.shadowingRule.id}'`
        );
      }
    }

    if (warnings.length > 0) {
      suggestions.push(
        `WARNING: ${warnings.length} rule(s) may not be applied as expected.`
      );
    }

    return suggestions;
  }

  /**
   * 验证规则列表
   */
  validateRules(rules: PermissionRule[]): ShadowedRuleDetectionResult {
    return this.detect(rules);
  }

  /**
   * 获取影子规则列表
   */
  getShadowedRules(rules: PermissionRule[]): PermissionRule[] {
    const result = this.detect(rules);
    return result.shadowedRules.map((s) => s.shadowedRule);
  }

  /**
   * 获取无效规则
   */
  getInvalidRules(rules: PermissionRule[]): PermissionRule[] {
    const result = this.detect(rules);
    return result.shadowedRules
      .filter((s) => s.severity === 'error')
      .map((s) => s.shadowedRule);
  }

  /**
   * 清除规则列表中的影子规则
   */
  cleanRules(
    rules: PermissionRule[],
    keepShadowing: boolean = true
  ): PermissionRule[] {
    const result = this.detect(rules);

    if (keepShadowing) {
      const shadowingIds = new Set(
        result.shadowedRules.map((s) => s.shadowingRule.id)
      );
      return rules.filter((r) => !shadowingIds.has(r.id));
    } else {
      const shadowedIds = new Set(
        result.shadowedRules.map((s) => s.shadowedRule.id)
      );
      return rules.filter((r) => !shadowedIds.has(r.id));
    }
  }

  /**
   * 重新排序规则
   */
  reorderRules(rules: PermissionRule[]): PermissionRule[] {
    return [...rules].sort((a, b) => {
      if (a.toolName === '*' && b.toolName !== '*') return 1;
      if (a.toolName !== '*' && b.toolName === '*') return -1;

      const aHasPattern = a.contentPattern ? 1 : 0;
      const bHasPattern = b.contentPattern ? 1 : 0;
      if (aHasPattern !== bHasPattern) return aHasPattern - bHasPattern;

      return (a.priority || 0) - (b.priority || 0);
    });
  }
}

/**
 * 导出单例
 */
export const shadowedRuleDetector = new ShadowedRuleDetector();
