/**
 * 邮件通道诊断模块
 * 对标 OpenClaw extensions/irc/src/doctor.ts
 *
 * 提供：SMTP 配置检查、发送连接可达性、连接状态等诊断
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

export interface EmailDiagnosisContext {
  host: string;
  port: number;
  user: string;
  hasPass: boolean;
  fromAddress: string;
  isConnected: boolean;
}

export function diagnoseEmail(ctx: EmailDiagnosisContext): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];

  checks.push(diagnoseConfig(ctx));
  checks.push(diagnoseServer(ctx));
  checks.push(diagnoseFromAddress(ctx));
  checks.push(diagnoseConnection(ctx));

  const failed = checks.filter((c) => !c.passed);

  return {
    healthy: failed.length === 0,
    checks,
    summary:
      failed.length === 0
        ? `${checks.length}/${checks.length} 检查通过，邮件通道运行正常`
        : `${failed.length} 项检查失败：${failed.map((c) => c.name).join(', ')}`,
  };
}

function diagnoseConfig(ctx: EmailDiagnosisContext): DiagnosisCheck {
  const missing: string[] = [];
  if (!ctx.host) missing.push('host');
  if (!ctx.user) missing.push('user');
  if (!ctx.hasPass) missing.push('pass');

  return {
    name: '配置检查',
    passed: missing.length === 0,
    message:
      missing.length === 0
        ? '所有必要配置项已设置'
        : `缺少配置项：${missing.join(', ')}`,
    detail: { missing, host: ctx.host, user: ctx.user },
  };
}

function diagnoseServer(ctx: EmailDiagnosisContext): DiagnosisCheck {
  return {
    name: 'SMTP 服务器',
    passed: !!ctx.host && ctx.port > 0,
    message: ctx.host
      ? `服务器：${ctx.host}:${ctx.port}`
      : '未指定 SMTP 服务器地址',
    detail: { host: ctx.host, port: ctx.port },
  };
}

function diagnoseFromAddress(ctx: EmailDiagnosisContext): DiagnosisCheck {
  const valid = !!ctx.fromAddress && ctx.fromAddress.includes('@');
  return {
    name: '发件人地址',
    passed: valid,
    message: valid
      ? `发件人：${ctx.fromAddress}`
      : '发件人地址无效或缺失',
    detail: { fromAddress: ctx.fromAddress },
  };
}

function diagnoseConnection(ctx: EmailDiagnosisContext): DiagnosisCheck {
  return {
    name: '连接状态',
    passed: ctx.isConnected,
    message: ctx.isConnected
      ? `已连接至 ${ctx.host}`
      : '未连接',
    detail: { connected: ctx.isConnected },
  };
}
