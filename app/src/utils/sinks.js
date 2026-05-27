/**
 * 分析系统初始化模块
 * 负责初始化分析数据的接收和处理
 */

import { AnalyticsService } from '../analytics/AnalyticsService.js';

/**
 * 初始化分析系统的接收端
 */
export function initSinks() {
  // 初始化分析服务
  const analyticsService = new AnalyticsService();
  analyticsService.initialize();

  // 可以在这里添加更多的接收端
  // 例如：日志接收端、监控接收端等
}
