/**
 * 钉钉通道诊断模块
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

export interface DingTalkDiagnosisContext {
  appKey: string;
  hasAppSecret: boolean;
  hasWebhookUrl: boolean;
  isConnected: boolean;
  hasAccessToken: boolean;
}

export function diagnoseDingTalk(
  ctx: DingTalkDiagnosisContext
): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];

  checks.push(diagnoseConfig(ctx));
  checks.push(diagnoseAuth(ctx));
  checks.push(diagnoseWebhook(ctx));
  checks.push(diagnoseConnection(ctx));

  const failed = checks.filter((c) => !c.passed);

  return {
    healthy: failed.length === 0,
    checks,
    summary:
      failed.length === 0
        ? `钉钉诊断通过（${checks.length}/${checks.length}）`
        : `钉钉诊断失败：${failed.map((c) => c.name).join(', ')}`,
  };
}

function diagnoseConfig(ctx: DingTalkDiagnosisContext): DiagnosisCheck {
  const missing: string[] = [];
  if (!ctx.appKey) missing.push('appKey');
  if (!ctx.hasAppSecret) missing.push('appSecret');

  return {
    name: '配置检查',
    passed: missing.length === 0,
    message:
      missing.length === 0
        ? '所有必要配置项已设置'
        : `缺少配置项：${missing.join(', ')}`,
    detail: { missing, appKey: ctx.appKey },
  };
}

function diagnoseAuth(ctx: DingTalkDiagnosisContext): DiagnosisCheck {
  return {
    name: '认证凭据',
    passed: !!ctx.appKey && ctx.hasAppSecret,
    message: ctx.hasAccessToken
      ? 'AccessToken 已获取'
      : '尚未获取 AccessToken',
    detail: { hasAccessToken: ctx.hasAccessToken },
  };
}

function diagnoseWebhook(ctx: DingTalkDiagnosisContext): DiagnosisCheck {
  return {
    name: 'Webhook 配置',
    passed: ctx.hasWebhookUrl,
    message: ctx.hasWebhookUrl
      ? 'Webhook URL 已配置'
      : '未配置 Webhook URL',
    detail: { webhookConfigured: ctx.hasWebhookUrl },
  };
}

function diagnoseConnection(ctx: DingTalkDiagnosisContext): DiagnosisCheck {
  return {
    name: '连接状态',
    passed: ctx.isConnected,
    message: ctx.isConnected ? '已连接' : '未连接',
    detail: { connected: ctx.isConnected },
  };
}
