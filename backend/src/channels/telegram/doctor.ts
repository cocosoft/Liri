/**
 * Telegram 通道诊断模块
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

export interface TelegramDiagnosisContext {
  hasBotToken: boolean;
  isConnected: boolean;
}

export function diagnoseTelegram(ctx: TelegramDiagnosisContext): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];
  checks.push({ name: '配置检查', passed: !!ctx.hasBotToken, message: ctx.hasBotToken ? 'Bot Token 已配置' : '缺少 Bot Token', detail: { hasBotToken: ctx.hasBotToken } });
  checks.push({ name: '连接状态', passed: ctx.isConnected, message: ctx.isConnected ? '已连接至 Telegram API' : '未连接', detail: { connected: ctx.isConnected } });
  const failed = checks.filter((c) => !c.passed);
  return { healthy: failed.length === 0, checks, summary: failed.length === 0 ? `Telegram 诊断通过（${checks.length}/${checks.length}）` : `Telegram 诊断失败：${failed.map((c) => c.name).join(', ')}` };
}
