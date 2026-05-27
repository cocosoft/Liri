/**
 * channels/qq/index.ts - QQ 通道导出
 */

export { qqChannel, createQQChannel, qqChannelPlugin } from './QQChannel.js';

export { getDefaultQQConfig, validateQQConfig } from './config-schema.js';
export type { QQConfig } from './config-schema.js';

export {
  registerQQAccount,
  getQQAccount,
  resolveQQAccount,
  listQQAccountIds,
  removeQQAccount,
} from './accounts.js';
export type { QQAccount, ResolvedQQAccount } from './accounts.js';

export { QQMonitor } from './monitor.js';
export type {
  MonitorEvent as QQMonitorEvent,
  MonitorStats as QQMonitorStats,
} from './monitor.js';

export { diagnoseQQ } from './doctor.js';
export type {
  DiagnosisResult as QQDiagnosisResult,
  QQDiagnosisContext,
} from './doctor.js';

export { qqProbe } from './probe.js';
export type { ProbeResult as QQProbeResult } from './probe.js';

export { setQQRuntime, getQQRuntime, clearQQRuntime } from './runtime.js';
export type { QQRuntime, QQRuntimeStatus } from './runtime.js';
