/**
 * QQ Bot 通道诊断模块
 * 对标 IRC doctor.ts 模式
 */

export interface DiagnosisResult {
  healthy: boolean;
  checks: DiagnosisCheck[];
  summary: string;
}

export interface DiagnosisCheck {
  name: string;
  passed: boolean;
  message: string;
  detail?: Record<string, unknown>;
}

export interface QQDiagnosisContext {
  hasAppId: boolean;
  hasClientSecret: boolean;
  isConnected: boolean;
}

export function diagnoseQQ(ctx: QQDiagnosisContext): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];
  checks.push({ name: '配置检查', passed: !!ctx.hasAppId && !!ctx.hasClientSecret, message: ctx.hasAppId && ctx.hasClientSecret ? 'AppID 和 ClientSecret 已配置' : '缺少 AppID 或 ClientSecret', detail: { hasAppId: ctx.hasAppId, hasClientSecret: ctx.hasClientSecret } });
  checks.push({ name: '连接状态', passed: ctx.isConnected, message: ctx.isConnected ? '已连接至 QQ Bot WebSocket' : '未连接', detail: { connected: ctx.isConnected } });
  const failed = checks.filter((c) => !c.passed);
  return { healthy: failed.length === 0, checks, summary: failed.length === 0 ? `QQ Bot 诊断通过（${checks.length}/${checks.length}）` : `QQ Bot 诊断失败：${failed.map((c) => c.name).join(', ')}` };
}
