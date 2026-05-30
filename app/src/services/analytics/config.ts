/**
 * 分析服务配置
 *
 * 提供分析功能的启用/禁用检查逻辑。
 * 参考 CC源码 cc_code/backend/services/analytics/config.ts
 */

export function isAnalyticsDisabled(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.ANALYTICS_DISABLED === 'true' ||
    process.env.Liri_TELEMETRY_DISABLED === 'true'
  );
}

export function isFeedbackSurveyDisabled(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.Liri_TELEMETRY_DISABLED === 'true'
  );
}
