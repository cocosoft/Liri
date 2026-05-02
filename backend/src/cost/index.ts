/**
 * 成本跟踪系统
 * 提供成本跟踪、计算和报告功能
 */

// 导出模型定价配置
export * from './ModelPricing.js';

// 导出成本跟踪器
export * from './CostTracker.js';

// 导出账单访问控制
export * from './BillingAccessControl.js';

// 导出定价管理器
export * from './PricingManager.js';

// 导出成本报告生成器
export * from './CostReporter.js';

// 导出成本缓存管理器
export * from './CostCache.js';

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

// 导出React Hooks
export * from './useCostSummary.js';

/**
 * 初始化成本跟踪系统
 */
export async function initializeCostTrackingSystem(): Promise<void> {
  try {
    const { billingAccessControlManager } = await import('./BillingAccessControl.js');
    const { pricingManager } = await import('./PricingManager.js');
    const { costCacheManager } = await import('./CostCache.js');
    const { costMonitor } = await import('./CostMonitor.js');

    // 初始化账单访问控制
    billingAccessControlManager.reloadFromEnvironment();

    // 初始化定价管理器
    pricingManager.updatePricing({}, '成本跟踪系统初始化');

    // 初始化成本缓存
    costCacheManager.setMaxCacheSize(1000);
    costCacheManager.setDefaultTTL(5 * 60 * 1000);

    // 初始化成本监控
    costMonitor.setConfig({
      enabled: true,
      checkInterval: 60 * 1000,
    });

    console.log('成本跟踪系统初始化完成');
  } catch (error) {
    console.error('成本跟踪系统初始化失败:', error);
  }
}

/**
 * 关闭成本跟踪系统
 */
export async function shutdownCostTrackingSystem(): Promise<void> {
  try {
    console.log('成本跟踪系统已关闭');
  } catch (error) {
    console.error('成本跟踪系统关闭失败:', error);
  }
}
