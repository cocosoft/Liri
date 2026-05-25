/**
 * 微信公众号通道诊断模块
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

export interface WechatDiagnosisContext {
  hasAppId: boolean;
  hasAppSecret: boolean;
  isConnected: boolean;
}

export function diagnoseWechat(ctx: WechatDiagnosisContext): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];
  checks.push({ name: '配置检查', passed: !!ctx.hasAppId && !!ctx.hasAppSecret, message: ctx.hasAppId && ctx.hasAppSecret ? 'AppID 和 AppSecret 已配置' : '缺少 AppID 或 AppSecret', detail: { hasAppId: ctx.hasAppId, hasAppSecret: ctx.hasAppSecret } });
  checks.push({ name: '连接状态', passed: ctx.isConnected, message: ctx.isConnected ? '已连接至微信公众平台' : '未连接', detail: { connected: ctx.isConnected } });
  const failed = checks.filter((c) => !c.passed);
  return { healthy: failed.length === 0, checks, summary: failed.length === 0 ? `微信诊断通过（${checks.length}/${checks.length}）` : `微信诊断失败：${failed.map((c) => c.name).join(', ')}` };
}
