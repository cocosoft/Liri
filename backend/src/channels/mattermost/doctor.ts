/**
 * Mattermost 通道诊断模块
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

export interface MattermostDiagnosisContext {
  hasServerUrl: boolean;
  hasBotToken: boolean;
  isConnected: boolean;
  serverReachable?: boolean;
}

export function diagnoseMattermost(
  ctx: MattermostDiagnosisContext
): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];

  checks.push({
    name: '服务器地址',
    passed: !!ctx.hasServerUrl,
    message: ctx.hasServerUrl ? 'Mattermost 服务器地址已配置' : '缺少服务器地址',
    detail: { hasServerUrl: ctx.hasServerUrl },
  });

  checks.push({
    name: 'Bot Token',
    passed: !!ctx.hasBotToken,
    message: ctx.hasBotToken ? 'Bot Token 已配置' : '缺少 Bot Token',
    detail: { hasBotToken: ctx.hasBotToken },
  });

  checks.push({
    name: '连接状态',
    passed: ctx.isConnected,
    message: ctx.isConnected ? '已连接至 Mattermost API' : '未连接',
    detail: { connected: ctx.isConnected },
  });

  if (ctx.serverReachable !== undefined) {
    checks.push({
      name: '服务器可达性',
      passed: ctx.serverReachable,
      message: ctx.serverReachable ? 'Mattermost 服务器可达' : '无法连接 Mattermost 服务器',
      detail: { serverReachable: ctx.serverReachable },
    });
  }

  const failed = checks.filter((c) => !c.passed);
  return {
    healthy: failed.length === 0,
    checks,
    summary:
      failed.length === 0
        ? `Mattermost 诊断通过（${checks.length}/${checks.length}）`
        : `Mattermost 诊断失败：${failed.map((c) => c.name).join(', ')}`,
  };
}
