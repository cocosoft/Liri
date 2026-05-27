/**
 * Facebook Messenger 通道诊断模块
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

export interface FacebookMessengerDiagnosisContext {
  hasPageAccessToken: boolean;
  hasVerifyToken: boolean;
  hasAppSecret: boolean;
  hasPageId: boolean;
  isConnected: boolean;
}

export function diagnoseFacebookMessenger(
  ctx: FacebookMessengerDiagnosisContext
): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];

  checks.push(diagnoseConfig(ctx));
  checks.push(diagnoseTokens(ctx));
  checks.push(diagnoseConnection(ctx));

  const failed = checks.filter((c) => !c.passed);

  return {
    healthy: failed.length === 0,
    checks,
    summary:
      failed.length === 0
        ? `Facebook Messenger 诊断通过（${checks.length}/${checks.length}）`
        : `Facebook Messenger 诊断失败：${failed.map((c) => c.name).join(', ')}`,
  };
}

function diagnoseConfig(
  ctx: FacebookMessengerDiagnosisContext
): DiagnosisCheck {
  const missing: string[] = [];
  if (!ctx.hasPageAccessToken) missing.push('pageAccessToken');
  if (!ctx.hasVerifyToken) missing.push('verifyToken');

  return {
    name: '配置检查',
    passed: missing.length === 0,
    message:
      missing.length === 0
        ? '所有必要配置项已设置'
        : `缺少配置项：${missing.join(', ')}`,
    detail: {
      missing,
      hasPageAccessToken: ctx.hasPageAccessToken,
      hasVerifyToken: ctx.hasVerifyToken,
    },
  };
}

function diagnoseTokens(
  ctx: FacebookMessengerDiagnosisContext
): DiagnosisCheck {
  return {
    name: '令牌检查',
    passed: ctx.hasPageAccessToken && ctx.hasVerifyToken,
    message: ctx.hasPageAccessToken
      ? 'Page Access Token 已配置'
      : 'Page Access Token 缺失',
    detail: {
      hasPageAccessToken: ctx.hasPageAccessToken,
      hasAppSecret: ctx.hasAppSecret,
      hasPageId: ctx.hasPageId,
    },
  };
}

function diagnoseConnection(
  ctx: FacebookMessengerDiagnosisContext
): DiagnosisCheck {
  return {
    name: '连接状态',
    passed: ctx.isConnected,
    message: ctx.isConnected ? '已连接至 Facebook Graph API' : '未连接',
    detail: { connected: ctx.isConnected },
  };
}
