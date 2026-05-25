/**
 * Twitter/X 通道诊断模块
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

export interface TwitterDiagnosisContext {
  hasApiKey: boolean;
  hasApiSecret: boolean;
  isConnected: boolean;
}

export function diagnoseTwitter(ctx: TwitterDiagnosisContext): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];
  checks.push({ name: '配置检查', passed: !!ctx.hasApiKey && !!ctx.hasApiSecret, message: ctx.hasApiKey && ctx.hasApiSecret ? 'API Key 和 API Secret 已配置' : '缺少 API Key 或 API Secret', detail: { hasApiKey: ctx.hasApiKey, hasApiSecret: ctx.hasApiSecret } });
  checks.push({ name: '连接状态', passed: ctx.isConnected, message: ctx.isConnected ? '已连接至 Twitter API' : '未连接', detail: { connected: ctx.isConnected } });
  const failed = checks.filter((c) => !c.passed);
  return { healthy: failed.length === 0, checks, summary: failed.length === 0 ? `Twitter 诊断通过（${checks.length}/${checks.length}）` : `Twitter 诊断失败：${failed.map((c) => c.name).join(', ')}` };
}
