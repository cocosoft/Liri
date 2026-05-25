/**
 * Claude 通道诊断模块
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

export interface ClaudeDiagnosisContext {
  hasApiKey: boolean;
  isConnected: boolean;
}

export function diagnoseClaude(ctx: ClaudeDiagnosisContext): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];
  checks.push({
    name: '配置检查',
    passed: !!ctx.hasApiKey,
    message: ctx.hasApiKey ? 'API Key 已配置' : '缺少 API Key',
    detail: { hasApiKey: ctx.hasApiKey },
  });
  checks.push({
    name: '连接状态',
    passed: ctx.isConnected,
    message: ctx.isConnected ? '已连接至 Claude API' : '未连接',
    detail: { connected: ctx.isConnected },
  });
  const failed = checks.filter((c) => !c.passed);
  return {
    healthy: failed.length === 0,
    checks,
    summary:
      failed.length === 0
        ? `Claude 诊断通过（${checks.length}/${checks.length}）`
        : `Claude 诊断失败：${failed.map((c) => c.name).join(', ')}`,
  };
}
