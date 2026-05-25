/**
 * BlueBubbles 通道诊断模块
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

export interface BlueBubblesDiagnosisContext {
  hasServerUrl: boolean;
  hasPassword: boolean;
  isConnected: boolean;
  serverReachable?: boolean;
  isPrivateNetwork?: boolean;
}

export function diagnoseBlueBubbles(
  ctx: BlueBubblesDiagnosisContext
): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];

  checks.push({
    name: '服务器地址',
    passed: !!ctx.hasServerUrl,
    message: ctx.hasServerUrl ? 'BlueBubbles 服务器地址已配置' : '缺少服务器地址',
    detail: { hasServerUrl: ctx.hasServerUrl },
  });

  checks.push({
    name: '访问密码',
    passed: !!ctx.hasPassword,
    message: ctx.hasPassword ? '访问密码已配置' : '缺少访问密码',
    detail: { hasPassword: ctx.hasPassword },
  });

  checks.push({
    name: '连接状态',
    passed: ctx.isConnected,
    message: ctx.isConnected ? '已连接至 BlueBubbles API' : '未连接',
    detail: { connected: ctx.isConnected },
  });

  if (ctx.serverReachable !== undefined) {
    checks.push({
      name: '服务器可达',
      passed: ctx.serverReachable,
      message: ctx.serverReachable ? 'BlueBubbles 服务器可达' : '无法连接 BlueBubbles 服务器',
      detail: { serverReachable: ctx.serverReachable },
    });
  }

  if (ctx.isPrivateNetwork !== undefined) {
    checks.push({
      name: '私有网络',
      passed: ctx.isPrivateNetwork,
      message: ctx.isPrivateNetwork
        ? 'BlueBubbles 在私有网络中运行（需要同网络访问）'
        : 'BlueBubbles 在公开网络中运行',
    });
  }

  const failed = checks.filter((c) => !c.passed);
  return {
    healthy: failed.length === 0,
    checks,
    summary:
      failed.length === 0
        ? `BlueBubbles 诊断通过（${checks.length}/${checks.length}）`
        : `BlueBubbles 诊断失败：${failed.map((c) => c.name).join(', ')}`,
  };
}
