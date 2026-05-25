/**
 * Zalo 通道诊断模块
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

export interface ZaloDiagnosisContext {
  hasAppId: boolean;
  hasAccessToken: boolean;
  isConnected: boolean;
}

export function diagnoseZalo(ctx: ZaloDiagnosisContext): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];
  checks.push({ name: '配置检查', passed: !!ctx.hasAppId && !!ctx.hasAccessToken, message: ctx.hasAppId && ctx.hasAccessToken ? 'App ID 和 Access Token 已配置' : '缺少 App ID 或 Access Token', detail: { hasAppId: ctx.hasAppId, hasAccessToken: ctx.hasAccessToken } });
  checks.push({ name: '连接状态', passed: ctx.isConnected, message: ctx.isConnected ? '已连接至 Zalo API' : '未连接', detail: { connected: ctx.isConnected } });
  const failed = checks.filter((c) => !c.passed);
  return { healthy: failed.length === 0, checks, summary: failed.length === 0 ? `Zalo 诊断通过（${checks.length}/${checks.length}）` : `Zalo 诊断失败：${failed.map((c) => c.name).join(', ')}` };
}
