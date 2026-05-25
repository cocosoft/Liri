/**
 * channels/yuanbao/index.ts - 元宝通道导出
 */

export {
  YuanbaoChannel,
  yuanbaoChannel,
  createYuanbaoChannel,
  yuanbaoChannelPlugin,
} from './YuanbaoChannel.js';
export type { YuanbaoConfig, YuanbaoMessage } from './YuanbaoChannel.js';

export { getDefaultYuanbaoConfig, validateYuanbaoConfig } from './config-schema.js';
export type { YuanbaoConfig as YuanbaoChannelConfig } from './config-schema.js';

export {
  registerYuanbaoAccount,
  getYuanbaoAccount,
  resolveYuanbaoAccount,
  listYuanbaoAccountIds,
  removeYuanbaoAccount,
} from './accounts.js';
export type { YuanbaoAccount, ResolvedYuanbaoAccount } from './accounts.js';

export { YuanbaoMonitor } from './monitor.js';
export type {
  MonitorEvent as YuanbaoMonitorEvent,
  MonitorStats as YuanbaoMonitorStats,
} from './monitor.js';

export { diagnoseYuanbao } from './doctor.js';
export type {
  DiagnosisResult as YuanbaoDiagnosisResult,
  YuanbaoDiagnosisContext,
} from './doctor.js';

export { yuanbaoProbe } from './probe.js';
export type { ProbeResult as YuanbaoProbeResult } from './probe.js';

export {
  setYuanbaoRuntime,
  getYuanbaoRuntime,
  clearYuanbaoRuntime,
} from './runtime.js';
export type { YuanbaoRuntime, YuanbaoRuntimeStatus } from './runtime.js';
