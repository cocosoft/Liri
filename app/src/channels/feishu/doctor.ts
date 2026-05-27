/**
 * 飞书通道诊断模块
 * 对标 OpenClaw extensions/feishu/src/doctor.ts
 *
 * 提供：配置检查、Token 有效性、API 可达性、连接状态等诊断
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

export interface DiagnosisContext {
  appId: string;
  appSecret: string;
  hasToken: boolean;
  tokenExpiresAt: number;
  isConnected: boolean;
  apiBase: string;
}

export function diagnoseFeishu(ctx: DiagnosisContext): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];

  checks.push(diagnoseConfig(ctx));
  checks.push(diagnoseToken(ctx));
  checks.push(diagnoseConnectivity(ctx));

  const passed = checks.filter((c) => c.passed);
  const failed = checks.filter((c) => !c.passed);

  return {
    healthy: failed.length === 0,
    checks,
    summary:
      failed.length === 0
        ? `${passed.length}/${checks.length} 检查通过，飞书通道运行正常`
        : `${failed.length} 项检查失败：${failed.map((c) => c.name).join(', ')}`,
  };
}

function diagnoseConfig(ctx: DiagnosisContext): DiagnosisCheck {
  const missing: string[] = [];
  if (!ctx.appId) missing.push('appId');
  if (!ctx.appSecret) missing.push('appSecret');

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

function diagnoseToken(ctx: DiagnosisContext): DiagnosisCheck {
  if (!ctx.hasToken) {
    return {
      name: 'Token 检查',
      passed: false,
      message: '尚未获取 tenant_access_token',
    };
  }
  const remainingS = Math.max(
    0,
    Math.floor((ctx.tokenExpiresAt - Date.now()) / 1000)
  );

  return {
    name: 'Token 检查',
    passed: remainingS > 60,
    message:
      remainingS > 60
        ? `Token 有效（剩余 ${remainingS} 秒）`
        : `Token 即将过期（仅剩 ${remainingS} 秒）`,
    detail: { expiresAt: ctx.tokenExpiresAt, remainingSeconds: remainingS },
  };
}

function diagnoseConnectivity(ctx: DiagnosisContext): DiagnosisCheck {
  return {
    name: '连接状态',
    passed: ctx.isConnected,
    message: ctx.isConnected ? 'WebSocket/Webhook 已连接' : '未连接',
    detail: { isConnected: ctx.isConnected, apiBase: ctx.apiBase },
  };
}
