//
/**
 * 成本跟踪器
 * 用于跟踪和计算模型使用的成本，参考CC源码的实现
 */

import { logForDebugging } from '../utils/debug.js';
import {
  calculateModelCost,
  formatCost,
  getModelPricing,
  getCanonicalModelName,
  hasUnknownModel,
  resetUnknownModelFlag,
} from './ModelPricing.js';
import type { CostRecordRepository } from './CostRecordRepository.js';

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
  /** 成本（美元） */
  costUSD: number;
  /** 是否快速模式 */
  isFastMode: boolean;
}

/**
 * 会话成本状态 - 用于会话恢复
 */
export interface SessionCostState {
  totalCostUSD: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadInputTokens: number;
  totalCacheCreationInputTokens: number;
  totalWebSearchRequests: number;
  modelUsage: Record<string, ModelUsage>;
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
  private modelUsage: Map<string, ModelUsage> = new Map();
  private startTime: number = Date.now();
  private recordRepository: CostRecordRepository | null = null;
  private currentSessionId: string = '';

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
    isFastMode: boolean = false
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

    // 更新模型使用信息
    const existingUsage = this.modelUsage.get(canonicalModelName);
    if (existingUsage) {
      existingUsage.inputTokens += inputTokens;
      existingUsage.outputTokens += outputTokens;
      existingUsage.cacheReadInputTokens += cacheReadTokens;
      existingUsage.cacheCreationInputTokens += cacheCreationTokens;
      existingUsage.webSearchRequests += webSearchRequests;
      existingUsage.costUSD += cost;
      existingUsage.isFastMode = isFastMode || existingUsage.isFastMode;
    } else {
      this.modelUsage.set(canonicalModelName, {
        inputTokens,
        outputTokens,
        cacheReadInputTokens: cacheReadTokens,
        cacheCreationInputTokens: cacheCreationTokens,
        webSearchRequests,
        costUSD: cost,
        isFastMode,
      });
    }

    this.persistCostRecord(
      canonicalModelName,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      cost
    );

    logForDebugging(`添加成本: ${formatCost(cost)} (${canonicalModelName})`, {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      webSearchRequests,
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
      logForDebugging('持久化成本记录失败', { error });
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
      usage.isFastMode
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
   * 获取会话成本状态（用于保存和恢复）
   */
  getSessionCostState(): SessionCostState {
    return {
      totalCostUSD: this.totalCostUSD,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalCacheReadInputTokens: this.totalCacheReadInputTokens,
      totalCacheCreationInputTokens: this.totalCacheCreationInputTokens,
      totalWebSearchRequests: this.totalWebSearchRequests,
      modelUsage: Object.fromEntries(this.modelUsage.entries()),
    };
  }

  /**
   * 从状态恢复成本跟踪
   */
  restoreFromState(state: SessionCostState): void {
    this.totalCostUSD = state.totalCostUSD;
    this.totalInputTokens = state.totalInputTokens;
    this.totalOutputTokens = state.totalOutputTokens;
    this.totalCacheReadInputTokens = state.totalCacheReadInputTokens;
    this.totalCacheCreationInputTokens = state.totalCacheCreationInputTokens;
    this.totalWebSearchRequests = state.totalWebSearchRequests;
    this.modelUsage = new Map(Object.entries(state.modelUsage));
    logForDebugging('成本跟踪已从状态恢复');
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
    this.modelUsage.clear();
    this.startTime = Date.now();
    resetUnknownModelFlag();
    logForDebugging('成本跟踪已重置');
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
 * 获取会话成本状态
 */
export function getSessionCostState(): SessionCostState {
  return costTracker.getSessionCostState();
}

/**
 * 从状态恢复成本跟踪
 */
export function restoreCostState(state: SessionCostState): void {
  costTracker.restoreFromState(state);
}
