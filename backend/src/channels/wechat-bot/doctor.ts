/**
 * 微信机器人通道诊断模块
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

export interface WechatBotDiagnosisContext {
  mode: 'ilink' | 'wcf';
  isConnected: boolean;
}

export function diagnoseWechatBot(ctx: WechatBotDiagnosisContext): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];
  checks.push({ name: '模式选择', passed: true, message: `当前模式：${ctx.mode}`, detail: { mode: ctx.mode } });
  checks.push({ name: '连接状态', passed: ctx.isConnected, message: ctx.isConnected ? `已连接至微信${ctx.mode === 'ilink' ? 'iLink' : 'WCF'}服务` : '未连接', detail: { connected: ctx.isConnected } });
  const failed = checks.filter((c) => !c.passed);
  return { healthy: failed.length === 0, checks, summary: failed.length === 0 ? `微信机器人诊断通过（${checks.length}/${checks.length}）` : `微信机器人诊断失败：${failed.map((c) => c.name).join(', ')}` };
}
