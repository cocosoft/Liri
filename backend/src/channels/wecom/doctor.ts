/**
 * 企业微信通道诊断模块
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

export interface WeComDiagnosisContext {
  hasCorpId: boolean;
  hasCorpSecret: boolean;
  isConnected: boolean;
}

export function diagnoseWeCom(ctx: WeComDiagnosisContext): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];
  checks.push({ name: '配置检查', passed: !!ctx.hasCorpId && !!ctx.hasCorpSecret, message: ctx.hasCorpId && ctx.hasCorpSecret ? 'CorpID 和 CorpSecret 已配置' : '缺少 CorpID 或 CorpSecret', detail: { hasCorpId: ctx.hasCorpId, hasCorpSecret: ctx.hasCorpSecret } });
  checks.push({ name: '连接状态', passed: ctx.isConnected, message: ctx.isConnected ? '已连接至企业微信 API' : '未连接', detail: { connected: ctx.isConnected } });
  const failed = checks.filter((c) => !c.passed);
  return { healthy: failed.length === 0, checks, summary: failed.length === 0 ? `企业微信诊断通过（${checks.length}/${checks.length}）` : `企业微信诊断失败：${failed.map((c) => c.name).join(', ')}` };
}
