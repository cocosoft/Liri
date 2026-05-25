/**
 * Nostr 通道诊断模块
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

export interface NostrDiagnosisContext {
  hasPublicKey: boolean;
  hasRelays: boolean;
  isConnected: boolean;
}

export function diagnoseNostr(ctx: NostrDiagnosisContext): DiagnosisResult {
  const checks: DiagnosisCheck[] = [];
  checks.push({ name: '配置检查', passed: !!ctx.hasPublicKey && ctx.hasRelays, message: ctx.hasPublicKey && ctx.hasRelays ? '公钥和 Relay 地址已配置' : '缺少公钥或 Relay 地址', detail: { hasPublicKey: ctx.hasPublicKey, hasRelays: ctx.hasRelays } });
  checks.push({ name: '连接状态', passed: ctx.isConnected, message: ctx.isConnected ? '已连接至 Nostr Relay' : '未连接', detail: { connected: ctx.isConnected } });
  const failed = checks.filter((c) => !c.passed);
  return { healthy: failed.length === 0, checks, summary: failed.length === 0 ? `Nostr 诊断通过（${checks.length}/${checks.length}）` : `Nostr 诊断失败：${failed.map((c) => c.name).join(', ')}` };
}
