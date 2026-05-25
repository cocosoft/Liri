/**
 * IRC 通道诊断模块
 * 对标 OpenClaw extensions/irc/src/doctor.ts
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

export interface IrcDiagnosisContext {
  server: string;
  port: number;
  nickname: string;
  tls: boolean;
  isConnected: boolean;
}

export function diagnoseIrc(ctx: IrcDiagnosisContext): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];

  checks.push(diagnoseConfig(ctx));
  checks.push(diagnoseServer(ctx));
  checks.push(diagnoseConnection(ctx));

  const failed = checks.filter((c) => !c.passed);

  return {
    healthy: failed.length === 0,
    checks,
    summary:
      failed.length === 0
        ? `IRC 诊断通过（${checks.length}/${checks.length}）`
        : `IRC 诊断失败：${failed.map((c) => c.name).join(', ')}`,
  };
}

function diagnoseConfig(ctx: IrcDiagnosisContext): DiagnosisCheck {
  const missing: string[] = [];
  if (!ctx.server) missing.push('server');
  if (!ctx.nickname) missing.push('nickname');
  if (!ctx.port) missing.push('port');

  return {
    name: '配置检查',
    passed: missing.length === 0,
    message:
      missing.length === 0
        ? '所有必要配置项已设置'
        : `缺少配置项：${missing.join(', ')}`,
    detail: { missing, server: ctx.server, port: ctx.port },
  };
}

function diagnoseServer(ctx: IrcDiagnosisContext): DiagnosisCheck {
  return {
    name: '服务器地址',
    passed: !!ctx.server,
    message: ctx.server
      ? `服务器：${ctx.server}:${ctx.port} (${ctx.tls ? 'TLS' : '明文'})`
      : '未指定服务器地址',
    detail: { server: ctx.server, port: ctx.port, tls: ctx.tls },
  };
}

function diagnoseConnection(ctx: IrcDiagnosisContext): DiagnosisCheck {
  return {
    name: '连接状态',
    passed: ctx.isConnected,
    message: ctx.isConnected
      ? `已连接至 ${ctx.server}（昵称：${ctx.nickname}）`
      : '未连接',
    detail: { isConnected: ctx.isConnected, nickname: ctx.nickname },
  };
}
