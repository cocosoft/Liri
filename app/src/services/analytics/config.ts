/**
 * 分析服务配置
 *
 * 提供分析功能的启用/禁用检查逻辑。
 * 参考 CC源码 cc_code/backend/services/analytics/config.ts
 */

import { configManager } from '@modules/config';

export function isAnalyticsDisabled(): boolean {
  return (
    configManager.env('NODE_ENV') === 'test' ||
    configManager.env('ANALYTICS_DISABLED') === 'true' ||
    configManager.env('LIRI_TELEMETRY_DISABLED') === 'true'
  );
}

export function isFeedbackSurveyDisabled(): boolean {
  return (
    configManager.env('NODE_ENV') === 'test' ||
    configManager.env('Liri_TELEMETRY_DISABLED') === 'true'
  );
}
