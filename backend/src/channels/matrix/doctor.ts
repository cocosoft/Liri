/**
 * Matrix 通道诊断模块
 * 对标 OpenClaw extensions/matrix/src/doctor.ts
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

export interface MatrixDiagnosisContext {
  homeserverUrl: string;
  userId: string;
  hasAccessToken: boolean;
  isConnected: boolean;
  lastSyncAt: number | null;
}

export function diagnoseMatrix(ctx: MatrixDiagnosisContext): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];

  checks.push(diagnoseConfig(ctx));
  checks.push(diagnoseCredentials(ctx));
  checks.push(diagnoseSync(ctx));

  const failed = checks.filter((c) => !c.passed);

  return {
    healthy: failed.length === 0,
    checks,
    summary:
      failed.length === 0
        ? `Matrix 诊断通过（${checks.length}/${checks.length}）`
        : `Matrix 诊断失败：${failed.map((c) => c.name).join(', ')}`,
  };
}

function diagnoseConfig(ctx: MatrixDiagnosisContext): DiagnosisCheck {
  const missing: string[] = [];
  if (!ctx.homeserverUrl) missing.push('homeserverUrl');
  if (!ctx.userId) missing.push('userId');

  return {
    name: '配置检查',
    passed: missing.length === 0,
    message:
      missing.length === 0
        ? `homeserver: ${ctx.homeserverUrl}, user: ${ctx.userId}`
        : `缺少配置项：${missing.join(', ')}`,
    detail: { missing, homeserverUrl: ctx.homeserverUrl, userId: ctx.userId },
  };
}

function diagnoseCredentials(ctx: MatrixDiagnosisContext): DiagnosisCheck {
  return {
    name: '凭据检查',
    passed: ctx.hasAccessToken,
    message: ctx.hasAccessToken ? 'access_token 已设置' : '缺少 accessToken',
  };
}

function diagnoseSync(ctx: MatrixDiagnosisContext): DiagnosisCheck {
  if (!ctx.isConnected) {
    return {
      name: '同步状态',
      passed: false,
      message: '未连接，无法同步',
    };
  }
  return {
    name: '同步状态',
    passed: ctx.lastSyncAt !== null,
    message: ctx.lastSyncAt
      ? `上次同步：${new Date(ctx.lastSyncAt).toISOString()}`
      : '尚未完成首次同步',
    detail: { lastSyncAt: ctx.lastSyncAt, isConnected: ctx.isConnected },
  };
}
