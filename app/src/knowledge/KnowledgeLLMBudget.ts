// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * LLM 成本预算控制器 — KnowledgeLLMBudget
 *
 * 日/小时 token 预算管理，支持自动降级策略。
 *   超出预算时: degrade（降级到关键词搜索）
 *
 * 预算配置通过 KnowledgeConfig 读取，环境变量可覆盖：
 *   KNOWLEDGE_LLM_DAILY_BUDGET=100000
 *   KNOWLEDGE_LLM_HOURLY_BUDGET=20000
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('knowledge:llmBudget');

interface HourlyTracker {
  hour: number; // Unix hour (floor)
  used: number;
}

export class KnowledgeLLMBudget {
  private dailyBudget: number;
  private hourlyBudget: number;
  private perCallWarningThreshold: number;
  dailyUsed: number = 0;
  private dailyResetDay: number = -1;
  private hourlyTracker: HourlyTracker = { hour: -1, used: 0 };

  constructor(dailyBudget?: number, hourlyBudget?: number) {
    this.dailyBudget =
      dailyBudget ??
      parseInt(process.env['KNOWLEDGE_LLM_DAILY_BUDGET'] || '100000', 10);
    this.hourlyBudget =
      hourlyBudget ??
      parseInt(process.env['KNOWLEDGE_LLM_HOURLY_BUDGET'] || '20000', 10);
    this.perCallWarningThreshold = 500;
    this.resetIfNeeded();
  }

  /** 检查是否有剩余预算 */
  hasRemaining(): boolean {
    this.resetIfNeeded();
    return (
      this.dailyUsed < this.dailyBudget &&
      this.hourlyTracker.used < this.hourlyBudget
    );
  }

  /** 消费 token */
  consume(tokens: number, source: string): void {
    this.resetIfNeeded();
    this.dailyUsed += tokens;
    this.hourlyTracker.used += tokens;

    if (tokens > this.perCallWarningThreshold) {
      logger.warn('LLM 调用消耗较高', { source, tokens });
    }

    if (!this.hasRemaining()) {
      logger.warn('LLM 预算耗尽，将降级到本地方案', {
        dailyUsed: this.dailyUsed,
        dailyBudget: this.dailyBudget,
        hourlyUsed: this.hourlyTracker.used,
        hourlyBudget: this.hourlyBudget,
      });
    }
  }

  /** 预估消耗（不实际消费） */
  estimate(tokens: number): { allowed: boolean; remainingDaily: number } {
    this.resetIfNeeded();
    return {
      allowed: this.dailyUsed + tokens <= this.dailyBudget,
      remainingDaily: this.dailyBudget - this.dailyUsed,
    };
  }

  /** 使用率百分比（0-100） */
  usagePercent(): number {
    this.resetIfNeeded();
    return Math.min(100, Math.round((this.dailyUsed / this.dailyBudget) * 100));
  }

  private resetIfNeeded(): void {
    const nowHour = Math.floor(Date.now() / 3600000);
    const nowDay = Math.floor(Date.now() / 86400000);

    if (this.dailyResetDay !== nowDay) {
      this.dailyUsed = 0;
      this.dailyResetDay = nowDay;
    }

    if (this.hourlyTracker.hour !== nowHour) {
      this.hourlyTracker = { hour: nowHour, used: 0 };
    }
  }
}
