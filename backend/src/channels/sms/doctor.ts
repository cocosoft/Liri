/**
 * SMS 通道诊断模块
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

export interface SmsDiagnosisContext {
  hasApiKey: boolean;
  hasFromNumber: boolean;
  isConnected: boolean;
}

export function diagnoseSms(ctx: SmsDiagnosisContext): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];
  checks.push({ name: '配置检查', passed: !!ctx.hasApiKey && !!ctx.hasFromNumber, message: ctx.hasApiKey && ctx.hasFromNumber ? 'API Key 和发送号码已配置' : '缺少 API Key 或发送号码', detail: { hasApiKey: ctx.hasApiKey, hasFromNumber: ctx.hasFromNumber } });
  checks.push({ name: '连接状态', passed: ctx.isConnected, message: ctx.isConnected ? '已连接至 SMS 服务商' : '未连接', detail: { connected: ctx.isConnected } });
  const failed = checks.filter((c) => !c.passed);
  return { healthy: failed.length === 0, checks, summary: failed.length === 0 ? `SMS 诊断通过（${checks.length}/${checks.length}）` : `SMS 诊断失败：${failed.map((c) => c.name).join(', ')}` };
}
