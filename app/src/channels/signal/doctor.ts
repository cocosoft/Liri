/**
 * Signal 通道诊断模块
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

export interface SignalDiagnosisContext {
  hasPhoneNumber: boolean;
  isConnected: boolean;
}

export function diagnoseSignal(ctx: SignalDiagnosisContext): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];
  checks.push({
    name: '配置检查',
    passed: !!ctx.hasPhoneNumber,
    message: ctx.hasPhoneNumber ? '手机号码已配置' : '缺少手机号码',
    detail: { hasPhoneNumber: ctx.hasPhoneNumber },
  });
  checks.push({
    name: '连接状态',
    passed: ctx.isConnected,
    message: ctx.isConnected ? '已连接至 Signal Service' : '未连接',
    detail: { connected: ctx.isConnected },
  });
  const failed = checks.filter((c) => !c.passed);
  return {
    healthy: failed.length === 0,
    checks,
    summary:
      failed.length === 0
        ? `Signal 诊断通过（${checks.length}/${checks.length}）`
        : `Signal 诊断失败：${failed.map((c) => c.name).join(', ')}`,
  };
}
