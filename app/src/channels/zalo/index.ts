/**
 * channels/zalo/index.ts - Zalo 通道导出
 */

export {
  ZaloChannel,
  zaloChannel,
  createZaloChannel,
  zaloChannelPlugin,
} from './ZaloChannel.js';
export type { ZaloConfig, ZaloMessage } from './ZaloChannel.js';

export { getDefaultZaloConfig, validateZaloConfig } from './config-schema.js';
export type { ZaloConfig as ZaloChannelConfig } from './config-schema.js';

export {
  registerZaloAccount,
  getZaloAccount,
  resolveZaloAccount,
  listZaloAccountIds,
  removeZaloAccount,
} from './accounts.js';
export type { ZaloAccount, ResolvedZaloAccount } from './accounts.js';

export { ZaloMonitor } from './monitor.js';
export type {
  MonitorEvent as ZaloMonitorEvent,
  MonitorStats as ZaloMonitorStats,
} from './monitor.js';

export { diagnoseZalo } from './doctor.js';
export type {
  DiagnosisResult as ZaloDiagnosisResult,
  ZaloDiagnosisContext,
} from './doctor.js';

export { zaloProbe } from './probe.js';
export type { ProbeResult as ZaloProbeResult } from './probe.js';

export { setZaloRuntime, getZaloRuntime, clearZaloRuntime } from './runtime.js';
export type { ZaloRuntime, ZaloRuntimeStatus } from './runtime.js';
