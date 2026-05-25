/**
 * Microsoft Teams 通道诊断模块
 * 对标 OpenClaw extensions/msteams/src/doctor.ts
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

export interface MSTeamsDiagnosisContext {
  tenantId: string;
  clientId: string;
  hasClientSecret: boolean;
  hasToken: boolean;
  isConnected: boolean;
  botEndpoint: string;
}

export function diagnoseMSTeams(ctx: MSTeamsDiagnosisContext): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];

  checks.push(diagnoseConfig(ctx));
  checks.push(diagnoseAuth(ctx));
  checks.push(diagnoseConnection(ctx));

  const failed = checks.filter((c) => !c.passed);

  return {
    healthy: failed.length === 0,
    checks,
    summary:
      failed.length === 0
        ? `Teams 诊断通过（${checks.length}/${checks.length}）`
        : `Teams 诊断失败：${failed.map((c) => c.name).join(', ')}`,
  };
}

function diagnoseConfig(ctx: MSTeamsDiagnosisContext): DiagnosisCheck {
  const missing: string[] = [];
  if (!ctx.tenantId) missing.push('tenantId');
  if (!ctx.clientId) missing.push('clientId');
  if (!ctx.hasClientSecret) missing.push('clientSecret');

  return {
    name: '配置检查',
    passed: missing.length === 0,
    message:
      missing.length === 0
        ? '所有必要配置项已设置'
        : `缺少配置项：${missing.join(', ')}`,
    detail: { missing, tenantId: ctx.tenantId, clientId: ctx.clientId },
  };
}

function diagnoseAuth(ctx: MSTeamsDiagnosisContext): DiagnosisCheck {
  return {
    name: '认证状态',
    passed: ctx.hasToken,
    message: ctx.hasToken
      ? 'Microsoft Identity Token 已获取'
      : '尚未获取 Token，无法调用 Bot Framework API',
  };
}

function diagnoseConnection(ctx: MSTeamsDiagnosisContext): DiagnosisCheck {
  return {
    name: '连接状态',
    passed: ctx.isConnected,
    message: ctx.isConnected
      ? `Bot 端点 ${ctx.botEndpoint} 已启动`
      : 'Bot 端点未启动',
    detail: { isConnected: ctx.isConnected, botEndpoint: ctx.botEndpoint },
  };
}
