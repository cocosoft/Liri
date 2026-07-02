//
/**
 * 成本跟踪器
 * 用于跟踪和计算模型使用的成本，参考CC源码的实现
 */

import { OTelAwareLogger } from '../monitoring/logs/OTelAwareLogger.js';
import {
  calculateModelCost,
  formatCost,
  getModelPricing,
  getCanonicalModelName,
  hasUnknownModel,
  resetUnknownModelFlag,
} from './ModelPricing.js';
import type { CostRecordRepository } from './CostRecordRepository.js';
import { globalEventBus, SystemEvents } from '@modules/core';
import type { CostRecordedEvent } from '@modules/core';

/**
 * 模型使用信息
 */
export interface ModelUsage {
  /** 输入令牌数 */
  inputTokens: number;
  /** 输出令牌数 */
  outputTokens: number;
  /** 缓存读取令牌数 */
  cacheReadInputTokens: number;
  /** 缓存创建令牌数 */
  cacheCreationInputTokens: number;
  /** 网络搜索请求数 */
  webSearchRequests: number;
  /** 推理令牌数（reasoning tokens） */
  reasoningTokens: number;
  /** 成本（美元） */
  costUSD: number;
  /** 是否快速模式 */
  isFastMode: boolean;
  /** 请求次数 */
  requestCount: number;
}

/**
 * 成本跟踪器
 */
export class CostTracker {
  private totalCostUSD: number = 0;
  private totalInputTokens: number = 0;
  private totalOutputTokens: number = 0;
  private totalCacheReadInputTokens: number = 0;
  private totalCacheCreationInputTokens: number = 0;
  private totalWebSearchRequests: number = 0;
  private totalReasoningTokens: number = 0;
  private modelUsage: Map<string, ModelUsage> = new Map();
  private startTime: number = Date.now();
  private recordRepository: CostRecordRepository | null = null;
  private currentSessionId: string = '';
  private otelLogger = new OTelAwareLogger({ module: 'cost:tracker' });

  /**
   * 设置成本记录存储库
   */
  setRecordRepository(
    repository: CostRecordRepository,
    sessionId?: string
  ): void {
    this.recordRepository = repository;
    if (sessionId) {
      this.currentSessionId = sessionId;
    }
  }

  /**
   * 设置当前会话ID
   */
  setSessionId(sessionId: string): void {
    this.currentSessionId = sessionId;
  }

  /**
   * 添加成本
   */
  addCost(
    modelName: string,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number = 0,
    cacheCreationTokens: number = 0,
    webSearchRequests: number = 0,
    isFastMode: boolean = false,
    reasoningTokens: number = 0
  ): number {
    const canonicalModelName = getCanonicalModelName(modelName);
    const cost = calculateModelCost(
      canonicalModelName,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      webSearchRequests,
      isFastMode
    );

    this.totalCostUSD += cost;
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;
    this.totalCacheReadInputTokens += cacheReadTokens;
    this.totalCacheCreationInputTokens += cacheCreationTokens;
    this.totalWebSearchRequests += webSearchRequests;
    this.totalReasoningTokens += reasoningTokens;

    // 更新模型使用信息
    const existingUsage = this.modelUsage.get(canonicalModelName);
    if (existingUsage) {
      existingUsage.inputTokens += inputTokens;
      existingUsage.outputTokens += outputTokens;
      existingUsage.cacheReadInputTokens += cacheReadTokens;
      existingUsage.cacheCreationInputTokens += cacheCreationTokens;
      existingUsage.webSearchRequests += webSearchRequests;
      existingUsage.reasoningTokens += reasoningTokens;
      existingUsage.costUSD += cost;
      existingUsage.isFastMode = isFastMode || existingUsage.isFastMode;
      existingUsage.requestCount += 1;
    } else {
      this.modelUsage.set(canonicalModelName, {
        inputTokens,
        outputTokens,
        cacheReadInputTokens: cacheReadTokens,
        cacheCreationInputTokens: cacheCreationTokens,
        webSearchRequests,
        reasoningTokens,
        costUSD: cost,
        isFastMode,
        requestCount: 1,
      });
    }

    // 发布成本记录事件（订阅者负责 SQLite 持久化）
    const eventData: CostRecordedEvent = {
      model: canonicalModelName,
      inputTokens,
      outputTokens,
      cacheReadInputTokens: cacheReadTokens,
      cacheCreationInputTokens: cacheCreationTokens,
      costUSD: cost,
      timestamp: Date.now(),
      sessionId: this.currentSessionId || undefined,
    };
    globalEventBus.publish(SystemEvents.COST_RECORDED, eventData);

    // 输出 OTel 上下文感知的结构化日志（自动注入 traceId/spanId）
    const level = cost === 0 ? 'warn' : 'info';
    this.otelLogger[level]('成本累加', {
      modelName: canonicalModelName,
      costUSD: cost,
      totalCostUSD: this.totalCostUSD,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      hasUnknownPricing: hasUnknownModel(),
      isFastMode,
    });

    return cost;
  }

  /**
   * 持久化成本记录到SQLite
   */
  private async persistCostRecord(
    model: string,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number,
    cacheCreationTokens: number,
    costUSD: number
  ): Promise<void> {
    if (!this.recordRepository) {
      return;
    }

    try {
      await this.recordRepository.recordCost({
        model,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        costUSD,
        sessionId: this.currentSessionId || undefined,
      });
    } catch (error) {
      this.otelLogger.warn('成本持久化失败', {
        error: error instanceof Error ? error.message : String(error),
        totalCostUSD: this.totalCostUSD,
      });
    }
  }

  /**
   * 从使用信息添加成本
   */
  addCostFromUsage(
    modelName: string,
    usage: Omit<ModelUsage, 'costUSD'>
  ): number {
    return this.addCost(
      modelName,
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheReadInputTokens,
      usage.cacheCreationInputTokens,
      usage.webSearchRequests,
      usage.isFastMode,
      usage.reasoningTokens || 0
    );
  }

  /**
   * 获取总成本
   */
  getTotalCostUSD(): number {
    return this.totalCostUSD;
  }

  /**
   * 获取总输入令牌数
   */
  getTotalInputTokens(): number {
    return this.totalInputTokens;
  }

  /**
   * 获取总输出令牌数
   */
  getTotalOutputTokens(): number {
    return this.totalOutputTokens;
  }

  /**
   * 获取总缓存读取令牌数
   */
  getTotalCacheReadInputTokens(): number {
    return this.totalCacheReadInputTokens;
  }

  /**
   * 获取总缓存创建令牌数
   */
  getTotalCacheCreationInputTokens(): number {
    return this.totalCacheCreationInputTokens;
  }

  /**
   * 获取总网络搜索请求数
   */
  getTotalWebSearchRequests(): number {
    return this.totalWebSearchRequests;
  }

  /**
   * 获取总推理令牌数
   */
  getTotalReasoningTokens(): number {
    return this.totalReasoningTokens;
  }

  /**
   * 获取会话持续时间（毫秒）
   */
  getSessionDuration(): number {
    return Date.now() - this.startTime;
  }

  /**
   * 获取模型使用信息
   */
  getModelUsage(): Record<string, ModelUsage> {
    return Object.fromEntries(this.modelUsage.entries());
  }

  /**
   * 获取指定模型的使用信息
   */
  getUsageForModel(modelName: string): ModelUsage | undefined {
    const canonicalName = getCanonicalModelName(modelName);
    return this.modelUsage.get(canonicalName);
  }

  /**
   * 是否有未知模型成本
   */
  hasUnknownModelCost(): boolean {
    return hasUnknownModel();
  }

  /**
   * 重置成本跟踪
   */
  reset(): void {
    this.totalCostUSD = 0;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.totalCacheReadInputTokens = 0;
    this.totalCacheCreationInputTokens = 0;
    this.totalWebSearchRequests = 0;
    this.totalReasoningTokens = 0;
    this.modelUsage.clear();
    this.startTime = Date.now();
    resetUnknownModelFlag();
    this.otelLogger.info('成本跟踪已重置');
  }

  /**
   * 格式化模型使用信息
   */
  private formatModelUsage(modelName: string, usage: ModelUsage): string {
    let result = `${modelName}:\n`;
    result += `  输入令牌: ${usage.inputTokens.toLocaleString()}\n`;
    result += `  输出令牌: ${usage.outputTokens.toLocaleString()}\n`;
    result += `  缓存读取令牌: ${usage.cacheReadInputTokens.toLocaleString()}\n`;
    result += `  缓存创建令牌: ${usage.cacheCreationInputTokens.toLocaleString()}\n`;
    if (usage.webSearchRequests > 0) {
      result += `  网络搜索请求: ${usage.webSearchRequests.toLocaleString()}\n`;
    }
    result += `  成本: ${formatCost(usage.costUSD)}\n`;
    if (usage.isFastMode) {
      result += `  模式: 快速模式\n`;
    }
    return result;
  }

  /**
   * 格式化成本报告
   */
  formatCostReport(detailed: boolean = false): string {
    let report = '\n========================================\n';
    report += '            成本报告\n';
    report += '========================================\n';
    report += `总成本: ${formatCost(this.totalCostUSD)}\n`;
    report += `总输入令牌: ${this.totalInputTokens.toLocaleString()}\n`;
    report += `总输出令牌: ${this.totalOutputTokens.toLocaleString()}\n`;
    report += `总缓存读取令牌: ${this.totalCacheReadInputTokens.toLocaleString()}\n`;
    report += `总缓存创建令牌: ${this.totalCacheCreationInputTokens.toLocaleString()}\n`;
    if (this.totalWebSearchRequests > 0) {
      report += `总网络搜索请求: ${this.totalWebSearchRequests.toLocaleString()}\n`;
    }
    report += `会话持续时间: ${(this.getSessionDuration() / 1000).toFixed(1)}秒\n`;

    if (this.hasUnknownModelCost()) {
      report += '\n⚠️  警告: 包含未知模型的成本，使用了默认定价\n';
    }

    if (this.modelUsage.size > 0) {
      report += '\n模型使用详情:\n';
      for (const [modelName, usage] of this.modelUsage.entries()) {
        report += `\n${this.formatModelUsage(modelName, usage)}`;
      }
    }

    if (detailed) {
      report += '\n详细定价信息:\n';
      for (const [modelName, usage] of this.modelUsage.entries()) {
        const pricing = getModelPricing(modelName, usage.isFastMode);
        report += `\n${modelName}:\n`;
        report += `  定价: ${formatCost(pricing.inputPricePerMillion)}/${formatCost(pricing.outputPricePerMillion)} 每百万令牌\n`;
        if (usage.webSearchRequests > 0) {
          report += `  网络搜索: ${formatCost(pricing.webSearchPricePerRequest)} 每次请求\n`;
        }
      }
    }

    report += '========================================\n';

    return report;
  }
}

/**
 * 全局成本跟踪器实例
 */
export const costTracker = new CostTracker();

/**
 * 添加成本
 */
export function addCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0,
  cacheCreationTokens: number = 0,
  webSearchRequests: number = 0,
  isFastMode: boolean = false
): number {
  return costTracker.addCost(
    modelName,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    webSearchRequests,
    isFastMode
  );
}

/**
 * 获取总成本
 */
export function getTotalCostUSD(): number {
  return costTracker.getTotalCostUSD();
}

/**
 * 获取总输入令牌数
 */
export function getTotalInputTokens(): number {
  return costTracker.getTotalInputTokens();
}

/**
 * 获取总输出令牌数
 */
export function getTotalOutputTokens(): number {
  return costTracker.getTotalOutputTokens();
}

/**
 * 获取总缓存读取令牌数
 */
export function getTotalCacheReadInputTokens(): number {
  return costTracker.getTotalCacheReadInputTokens();
}

/**
 * 获取总缓存创建令牌数
 */
export function getTotalCacheCreationInputTokens(): number {
  return costTracker.getTotalCacheCreationInputTokens();
}

/**
 * 获取总网络搜索请求数
 */
export function getTotalWebSearchRequests(): number {
  return costTracker.getTotalWebSearchRequests();
}

/**
 * 获取模型使用信息
 */
export function getModelUsage(): Record<string, ModelUsage> {
  return costTracker.getModelUsage();
}

/**
 * 获取指定模型的使用信息
 */
export function getUsageForModel(modelName: string): ModelUsage | undefined {
  return costTracker.getUsageForModel(modelName);
}

/**
 * 是否有未知模型成本
 */
export function hasUnknownModelCost(): boolean {
  return costTracker.hasUnknownModelCost();
}

/**
 * 重置成本跟踪
 */
export function resetCostTracking(): void {
  costTracker.reset();
}

/**
 * 格式化成本报告
 */
export function formatCostReport(detailed: boolean = false): string {
  return costTracker.formatCostReport(detailed);
}

/**
 * 获取模型使用统计
 */
