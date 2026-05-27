/**
 * Prompt Suggestion 事件追踪模块
 * 基于CC源码设计
 */

import type { PromptVariant, SuggestionSource } from './types';

export interface SuggestionEvent {
  type: 'suppressed' | 'shown' | 'accepted' | 'ignored';
  reason?: string;
  suggestion?: string;
  promptId?: PromptVariant;
  source?: SuggestionSource;
  timestamp: number;
}

export interface AnalyticsData {
  suggestionShown: number;
  suggestionAccepted: number;
  suggestionIgnored: number;
  suppressedCount: number;
  suppressReasons: Record<string, number>;
  averageAcceptTime: number;
  totalSuggestions: number;
}

let eventLog: SuggestionEvent[] = [];
let analyticsData: AnalyticsData = {
  suggestionShown: 0,
  suggestionAccepted: 0,
  suggestionIgnored: 0,
  suppressedCount: 0,
  suppressReasons: {},
  averageAcceptTime: 0,
  totalSuggestions: 0,
};

/**
 * 记录建议被抑制
 */
export function logSuggestionSuppressed(
  reason: string,
  suggestion?: string,
  promptId?: PromptVariant,
  source?: SuggestionSource
): void {
  eventLog.push({
    type: 'suppressed',
    reason,
    suggestion,
    promptId,
    source,
    timestamp: Date.now(),
  });

  analyticsData.suppressedCount++;
  analyticsData.suppressReasons[reason] =
    (analyticsData.suppressReasons[reason] || 0) + 1;

  if (process.env.DEBUG_PROMPT_SUGGESTION === 'true') {
    console.log(`[PromptSuggestion] Suppressed: ${reason}`, {
      suggestion,
      promptId,
      source,
    });
  }
}

/**
 * 记录建议已显示
 */
export function logSuggestionShown(
  suggestion: string,
  promptId: PromptVariant,
  source?: SuggestionSource
): void {
  eventLog.push({
    type: 'shown',
    suggestion,
    promptId,
    source,
    timestamp: Date.now(),
  });

  analyticsData.suggestionShown++;
  analyticsData.totalSuggestions++;

  if (process.env.DEBUG_PROMPT_SUGGESTION === 'true') {
    console.log(`[PromptSuggestion] Shown: ${suggestion}`, {
      promptId,
      source,
    });
  }
}

/**
 * 记录建议被接受
 */
export function logSuggestionAccepted(
  suggestion: string,
  userInput: string,
  promptId: PromptVariant,
  acceptMethod?: 'tab' | 'enter',
  timeToAcceptMs?: number
): void {
  eventLog.push({
    type: 'accepted',
    suggestion,
    promptId,
    timestamp: Date.now(),
  });

  analyticsData.suggestionAccepted++;

  if (timeToAcceptMs !== undefined) {
    const totalTime =
      analyticsData.averageAcceptTime * (analyticsData.suggestionAccepted - 1);
    analyticsData.averageAcceptTime =
      (totalTime + timeToAcceptMs) / analyticsData.suggestionAccepted;
  }

  if (process.env.DEBUG_PROMPT_SUGGESTION === 'true') {
    console.log(`[PromptSuggestion] Accepted: ${suggestion}`, {
      userInput,
      promptId,
      acceptMethod,
      timeToAcceptMs,
    });
  }
}

/**
 * 记录建议被忽略
 */
export function logSuggestionIgnored(
  suggestion: string,
  promptId: PromptVariant,
  timeToIgnoreMs?: number
): void {
  eventLog.push({
    type: 'ignored',
    suggestion,
    promptId,
    timestamp: Date.now(),
  });

  analyticsData.suggestionIgnored++;

  if (process.env.DEBUG_PROMPT_SUGGESTION === 'true') {
    console.log(`[PromptSuggestion] Ignored: ${suggestion}`, {
      promptId,
      timeToIgnoreMs,
    });
  }
}

/**
 * 获取事件日志
 */
export function getEventLog(): SuggestionEvent[] {
  return [...eventLog];
}

/**
 * 获取分析数据
 */
export function getAnalyticsData(): AnalyticsData {
  return { ...analyticsData };
}

/**
 * 重置分析数据
 */
export function resetAnalytics(): void {
  eventLog = [];
  analyticsData = {
    suggestionShown: 0,
    suggestionAccepted: 0,
    suggestionIgnored: 0,
    suppressedCount: 0,
    suppressReasons: {},
    averageAcceptTime: 0,
    totalSuggestions: 0,
  };
}

/**
 * 获取接受率
 */
export function getAcceptanceRate(): number {
  if (analyticsData.totalSuggestions === 0) {
    return 0;
  }
  return analyticsData.suggestionAccepted / analyticsData.totalSuggestions;
}

/**
 * 获取抑制率
 */
export function getSuppressionRate(): number {
  if (analyticsData.totalSuggestions === 0) {
    return 0;
  }
  return analyticsData.suppressedCount / analyticsData.totalSuggestions;
}

/**
 * 获取按原因分类的抑制统计
 */
export function getSuppressReasonStats(): Record<string, number> {
  return { ...analyticsData.suppressReasons };
}
