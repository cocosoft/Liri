/**
 * Google Chat 通道诊断模块
 * 对标 OpenClaw extensions/googlechat/src/doctor.ts
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

export interface GoogleChatDiagnosisContext {
  serviceAccountEmail: string;
  hasServiceAccountKey: boolean;
  hasToken: boolean;
  isConnected: boolean;
  scope: string;
}

export function diagnoseGoogleChat(
  ctx: GoogleChatDiagnosisContext
): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];

  checks.push(diagnoseConfig(ctx));
  checks.push(diagnoseCredentials(ctx));
  checks.push(diagnoseAuth(ctx));
  checks.push(diagnoseConnection(ctx));

  const failed = checks.filter((c) => !c.passed);

  return {
    healthy: failed.length === 0,
    checks,
    summary:
      failed.length === 0
        ? `Google Chat 诊断通过（${checks.length}/${checks.length}）`
        : `Google Chat 诊断失败：${failed.map((c) => c.name).join(', ')}`,
  };
}

function diagnoseConfig(ctx: GoogleChatDiagnosisContext): DiagnosisCheck {
  return {
    name: '配置检查',
    passed: !!ctx.serviceAccountEmail && !!ctx.hasServiceAccountKey,
    message: ctx.serviceAccountEmail
      ? `服务账户：${ctx.serviceAccountEmail}`
      : '缺少 serviceAccountEmail',
    detail: { serviceAccountEmail: ctx.serviceAccountEmail },
  };
}

function diagnoseCredentials(ctx: GoogleChatDiagnosisContext): DiagnosisCheck {
  return {
    name: '凭据检查',
    passed: ctx.hasServiceAccountKey,
    message: ctx.hasServiceAccountKey
      ? '服务账户密钥已设置'
      : '缺少 serviceAccountKey',
  };
}

function diagnoseAuth(ctx: GoogleChatDiagnosisContext): DiagnosisCheck {
  return {
    name: '认证状态',
    passed: ctx.hasToken,
    message: ctx.hasToken ? 'JWT/OAuth Token 已获取' : '尚未获取 Token',
    detail: { scope: ctx.scope },
  };
}

function diagnoseConnection(ctx: GoogleChatDiagnosisContext): DiagnosisCheck {
  return {
    name: '连接状态',
    passed: ctx.isConnected,
    message: ctx.isConnected ? 'Webhook 服务已启动' : 'Webhook 服务未启动',
    detail: { isConnected: ctx.isConnected },
  };
}
