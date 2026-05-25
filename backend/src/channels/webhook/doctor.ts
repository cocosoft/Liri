/**
 * Webhook 通道诊断模块
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

export interface WebhookDiagnosisContext {
  hasSecret: boolean;
  isListening: boolean;
  port: number;
}

export function diagnoseWebhook(ctx: WebhookDiagnosisContext): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];
  checks.push({ name: '配置检查', passed: !!ctx.hasSecret, message: ctx.hasSecret ? '签名密钥已配置' : '缺少签名密钥', detail: { hasSecret: ctx.hasSecret } });
  checks.push({ name: '服务状态', passed: ctx.isListening, message: ctx.isListening ? `Webhook 服务器正在监听端口 ${ctx.port}` : 'Webhook 服务器未启动', detail: { port: ctx.port, listening: ctx.isListening } });
  const failed = checks.filter((c) => !c.passed);
  return { healthy: failed.length === 0, checks, summary: failed.length === 0 ? `Webhook 诊断通过（${checks.length}/${checks.length}）` : `Webhook 诊断失败：${failed.map((c) => c.name).join(', ')}` };
}
