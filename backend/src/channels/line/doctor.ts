/**
 * LINE 通道诊断模块
 * 对标 OpenClaw extensions/line/src/doctor.ts
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

export interface LineDiagnosisContext {
  hasChannelSecret: boolean;
  hasAccessToken: boolean;
  isConnected: boolean;
  webhookPort: number;
}

export function diagnoseLine(ctx: LineDiagnosisContext): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];

  checks.push(diagnoseConfig(ctx));
  checks.push(diagnoseCredentials(ctx));
  checks.push(diagnoseConnection(ctx));

  const failed = checks.filter((c) => !c.passed);

  return {
    healthy: failed.length === 0,
    checks,
    summary:
      failed.length === 0
        ? `LINE 诊断通过（${checks.length}/${checks.length}）`
        : `LINE 诊断失败：${failed.map((c) => c.name).join(', ')}`,
  };
}

function diagnoseConfig(ctx: LineDiagnosisContext): DiagnosisCheck {
  const missing: string[] = [];
  if (!ctx.hasChannelSecret) missing.push('channelSecret');
  if (!ctx.hasAccessToken) missing.push('channelAccessToken');

  return {
    name: '配置检查',
    passed: missing.length === 0,
    message:
      missing.length === 0
        ? '所有必要配置项已设置'
        : `缺少配置项：${missing.join(', ')}`,
    detail: { missing },
  };
}

function diagnoseCredentials(ctx: LineDiagnosisContext): DiagnosisCheck {
  const bothSet = ctx.hasChannelSecret && ctx.hasAccessToken;
  return {
    name: '凭据检查',
    passed: bothSet,
    message: bothSet
      ? 'Channel Secret 和 Access Token 均已设置'
      : '凭据不完整',
    detail: {
      channelSecret: ctx.hasChannelSecret,
      channelAccessToken: ctx.hasAccessToken,
    },
  };
}

function diagnoseConnection(ctx: LineDiagnosisContext): DiagnosisCheck {
  return {
    name: '连接状态',
    passed: ctx.isConnected,
    message: ctx.isConnected
      ? `Webhook 服务已启动（端口 ${ctx.webhookPort}）`
      : 'Webhook 服务未启动',
    detail: { isConnected: ctx.isConnected, webhookPort: ctx.webhookPort },
  };
}
