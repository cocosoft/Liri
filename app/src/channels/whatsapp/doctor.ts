/**
 * WhatsApp 通道诊断模块
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

export interface WhatsAppDiagnosisContext {
  hasPhoneNumberId: boolean;
  hasAccessToken: boolean;
  isConnected: boolean;
}

export function diagnoseWhatsApp(
  ctx: WhatsAppDiagnosisContext
): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];
  checks.push({
    name: '配置检查',
    passed: !!ctx.hasPhoneNumberId && !!ctx.hasAccessToken,
    message:
      ctx.hasPhoneNumberId && ctx.hasAccessToken
        ? 'Phone Number ID 和 Access Token 已配置'
        : '缺少 Phone Number ID 或 Access Token',
    detail: {
      hasPhoneNumberId: ctx.hasPhoneNumberId,
      hasAccessToken: ctx.hasAccessToken,
    },
  });
  checks.push({
    name: '连接状态',
    passed: ctx.isConnected,
    message: ctx.isConnected ? '已连接至 WhatsApp Cloud API' : '未连接',
    detail: { connected: ctx.isConnected },
  });
  const failed = checks.filter((c) => !c.passed);
  return {
    healthy: failed.length === 0,
    checks,
    summary:
      failed.length === 0
        ? `WhatsApp 诊断通过（${checks.length}/${checks.length}）`
        : `WhatsApp 诊断失败：${failed.map((c) => c.name).join(', ')}`,
  };
}
