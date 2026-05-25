/**
 * Slack 通道诊断模块
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

export interface SlackDiagnosisContext {
  hasBotToken: boolean;
  hasSigningSecret: boolean;
  isConnected: boolean;
}

export function diagnoseSlack(ctx: SlackDiagnosisContext): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];
  checks.push({ name: '配置检查', passed: !!ctx.hasBotToken, message: ctx.hasBotToken ? 'Bot Token 已配置' : '缺少 Bot Token', detail: { hasBotToken: ctx.hasBotToken, hasSigningSecret: ctx.hasSigningSecret } });
  checks.push({ name: '连接状态', passed: ctx.isConnected, message: ctx.isConnected ? '已连接至 Slack API' : '未连接', detail: { connected: ctx.isConnected } });
  const failed = checks.filter((c) => !c.passed);
  return { healthy: failed.length === 0, checks, summary: failed.length === 0 ? `Slack 诊断通过（${checks.length}/${checks.length}）` : `Slack 诊断失败：${failed.map((c) => c.name).join(', ')}` };
}
