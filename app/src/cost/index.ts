// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
/**
 * 成本跟踪系统
 * 提供成本跟踪、计算和报告功能
 */

// 导出模型定价配置（排除与EnhancedCostManager重复的导出）
export {
  calculateModelCost,
  formatCost,
  getModelPricing,
  getCanonicalModelName,
  hasUnknownModel,
  resetUnknownModelFlag,
} from './ModelPricing.js';
export type { ModelPricing } from './ModelPricing.js';

// 导出成本跟踪器
export * from './CostTracker.js';

// 导出账单访问控制
export * from './BillingAccessControl.js';

// 导出定价管理器
export * from './PricingManager.js';

// 导出成本报告生成器
export {
  CostReporter,
  CostTrend,
  CostReportOptions,
  addCostTrend,
  getCostTrends,
  analyzeCostTrend,
  predictCost,
  generateCostReport,
  costReporter,
} from './CostReporter.js';
export type { CostPrediction as CostReportPrediction } from './CostReporter.js';

export type { CostPrediction } from './EnhancedCostManager.js';

// 导出成本监控器
export * from './CostMonitor.js';

// 导出增强成本管理器
export * from './EnhancedCostManager.js';

// 导出成本预测器
export * from './CostPredictor.js';

// 导出高级成本分析器
export * from './AdvancedCostAnalyzer.js';

// 导出预算管理器
export * from './CostBudgetManager.js';

// 导出成本记录存储库
export * from './CostRecordRepository.js';

// 导出React Hooks
export * from './useCostSummary.js';

// 导出部门成本报表
export {
  DepartmentCostReporter,
  getDepartmentCostReporter,
} from './DepartmentCostReporter';
export type {
  CostAllocationReport,
  DepartmentCostEntry,
  TeamCostEntry,
} from './DepartmentCostReporter';

// 导出 OTel Metrics 桥
export { CostMetricsBridge, getCostMetricsBridge } from './CostMetricsBridge';
export type {
  CostMetricsDataPoint,
  CostDashboardData,
  MetricsBridgeConfig,
} from './CostMetricsBridge';

// 导出 HTTP 端点
export { CostReportEndpoint } from './CostReportEndpoint';
export type {
  CostReportRequest,
  CostReportResponse,
  CostReportData,
} from './CostReportEndpoint';

import { Logger } from '../monitoring/logs/Logger.js';
import { globalEventBus, SystemEvents } from '@modules/core/events/EventBus';
import type { CostRecordedEvent } from '@modules/core/events/EventBus';

const logger = new Logger();

/**
 * 初始化成本跟踪系统
 */
export async function initializeCostTrackingSystem(): Promise<void> {
  try {
    const { pricingManager } = await import('./PricingManager.js');
    const { costMonitor } = await import('./CostMonitor.js');
    const { costTracker } = await import('./CostTracker.js');
    const { getCostRecordRepository } =
      await import('./CostRecordRepository.js');

    // 初始化账单访问控制已通过单例完成

    // 初始化定价管理器
    pricingManager.updatePricing({}, '成本跟踪系统初始化');

    // 初始化成本监控
    costMonitor.setConfig({
      enabled: true,
      checkInterval: 60 * 1000,
    });

    // 初始化成本记录存储库并关联到跟踪器
    const repository = getCostRecordRepository();
    await repository.initDatabase();
    costTracker.setRecordRepository(repository);

    // 注册成本记录事件订阅者（事件驱动持久化）
    globalEventBus.subscribe(
      SystemEvents.COST_RECORDED,
      async (event: CostRecordedEvent) => {
        try {
          await repository.recordCost({
            model: event.model,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            cacheReadTokens: event.cacheReadInputTokens,
            cacheCreationTokens: event.cacheCreationInputTokens,
            costUSD: event.costUSD,
            sessionId: event.sessionId,
          });
        } catch (error) {
          logger.error('事件驱动持久化成本记录失败', {
            error: error instanceof Error ? error.message : String(error),
            model: event.model,
            costUSD: event.costUSD,
          });
        }
      }
    );

    // 初始化分析持久化服务（JSONL 文件）
    const { getGlobalAnalyticsQueue } =
      await import('../analytics/AnalyticsEventQueue.js');
    const { AnalyticsPersistenceService } =
      await import('../analytics/AnalyticsPersistenceService.js');
    const analyticsPersistence = new AnalyticsPersistenceService();
    await analyticsPersistence.initialize();
    getGlobalAnalyticsQueue().attachSink({
      logEvent: (eventName, metadata) => {
        analyticsPersistence.persistEvent({
          timestamp: Date.now(),
          async: false,
          schemaVersion: '1.0.0',
          category: 'system' as any,
          severity: 'info' as any,
          eventName,
          metadata: metadata,
        });
      },
      logEventAsync: async (eventName, metadata) => {
        await analyticsPersistence.persistEvent({
          timestamp: Date.now(),
          async: false,
          schemaVersion: '1.0.0',
          category: 'system' as any,
          severity: 'info' as any,
          eventName,
          metadata: metadata,
        });
      },
    });

    // 确保 CostAnalyticsTracker 使用全局事件队列（含持久化 sink）
    const { getCostAnalyticsTracker } =
      await import('../analytics/CostAnalyticsTracker.js');
    getCostAnalyticsTracker(getGlobalAnalyticsQueue());

    logger.info('成本跟踪系统初始化完成');
  } catch (error) {
    logger.error(
      '成本跟踪系统初始化失败',
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

/**
 * 关闭成本跟踪系统
 */
export async function shutdownCostTrackingSystem(): Promise<void> {
  try {
    const { getCostRecordRepository } =
      await import('./CostRecordRepository.js');

    // 已通过事件驱动持久化到 SQLite，无需额外 JSON 持久化

    const repository = getCostRecordRepository();
    await repository.close();

    logger.info('成本跟踪系统已关闭');
  } catch (error) {
    logger.error(
      '成本跟踪系统关闭失败',
      error instanceof Error ? error : new Error(String(error))
    );
  }
}
