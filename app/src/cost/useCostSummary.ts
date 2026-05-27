/**
 * 成本摘要Hook
 * * 在进程退出时输出成本摘要
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });
import {
  costTracker,
  type SessionCostState,
  type ModelUsage,
  formatCostReport,
  getTotalCostUSD,
  getTotalInputTokens,
  getTotalOutputTokens,
  getModelUsage,
} from './CostTracker';

/**
 * 成本摘要信息
 */
export interface CostSummary {
  /** 总成本（美元） */
  totalCostUSD: number;
  /** 总输入令牌数 */
  totalInputTokens: number;
  /** 总输出令牌数 */
  totalOutputTokens: number;
  /** 总缓存读取令牌数 */
  totalCacheReadTokens: number;
  /** 总缓存创建令牌数 */
  totalCacheCreationTokens: number;
  /** 总网络搜索请求数 */
  totalWebSearchRequests: number;
  /** 模型使用详情 */
  modelUsage: Record<string, ModelUsage>;
  /** 是否有未知模型成本 */
  hasUnknownModelCost: boolean;
}

/**
 * useCostSummary Hook结果
 */
export interface UseCostSummaryResult {
  /** 成本摘要 */
  summary: CostSummary;
  /** 格式化的成本报告 */
  formattedReport: string;
  /** 是否正在计算 */
  isCalculating: boolean;
  /** 刷新摘要 */
  refresh: () => void;
  /** 重置成本跟踪 */
  reset: () => void;
}

/**
 * useCostSummary Hook
 * @returns 成本摘要信息和操作方法
 */
export function useCostSummary(): UseCostSummaryResult {
  const [isCalculating, setIsCalculating] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // 获取成本摘要
  const summary = useMemo((): CostSummary => {
    const state = costTracker.getSessionCostState();

    return {
      totalCostUSD: state.totalCostUSD,
      totalInputTokens: state.totalInputTokens,
      totalOutputTokens: state.totalOutputTokens,
      totalCacheReadTokens: state.totalCacheReadInputTokens,
      totalCacheCreationTokens: state.totalCacheCreationInputTokens,
      totalWebSearchRequests: state.totalWebSearchRequests,
      modelUsage: state.modelUsage,
      hasUnknownModelCost: costTracker.hasUnknownModelCost(),
    };
  }, [refreshTrigger]);

  // 格式化报告
  const formattedReport = useMemo(() => {
    return formatCostReport(true);
  }, [summary]);

  // 刷新摘要
  const refresh = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  // 重置成本跟踪
  const reset = useCallback(() => {
    costTracker.reset();
    refresh();
  }, [refresh]);

  // 在进程退出时输出成本摘要
  useEffect(() => {
    const handleExit = () => {
      try {
        const report = formatCostReport(true);
        logger.info(report);
      } catch (error) {
        logger.error('输出成本摘要失败:', { error });
      }
    };

    // 注册退出处理
    process.on('exit', handleExit);
    process.on('SIGINT', handleExit);
    process.on('SIGTERM', handleExit);

    return () => {
      process.off('exit', handleExit);
      process.off('SIGINT', handleExit);
      process.off('SIGTERM', handleExit);
    };
  }, []);

  return {
    summary,
    formattedReport,
    isCalculating,
    refresh,
    reset,
  };
}

/**
 * 获取格式化的成本摘要文本
 */
export function useFormattedCostSummary(): string {
  const { formattedReport } = useCostSummary();
  return formattedReport;
}

/**
 * 获取总成本
 */
export function useTotalCost(): number {
  return getTotalCostUSD();
}

/**
 * 获取模型使用详情
 */
export function useModelUsage(): Record<string, ModelUsage> {
  return getModelUsage();
}
