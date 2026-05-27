/**
 * channels/wecom/index.ts - 企业微信通道导出
 */

export {
  wecomChannel,
  createWecomChannel,
  wecomChannelPlugin,
} from './WeComChannel.js';

export { getDefaultWeComConfig, validateWeComConfig } from './config-schema.js';
export type { WeComConfig } from './config-schema.js';

export {
  registerWeComAccount,
  getWeComAccount,
  resolveWeComAccount,
  listWeComAccountIds,
  removeWeComAccount,
} from './accounts.js';
export type { WeComAccount, ResolvedWeComAccount } from './accounts.js';

export { WeComMonitor } from './monitor.js';
export type {
  MonitorEvent as WeComMonitorEvent,
  MonitorStats as WeComMonitorStats,
} from './monitor.js';

export { diagnoseWeCom } from './doctor.js';
export type {
  DiagnosisResult as WeComDiagnosisResult,
  WeComDiagnosisContext,
} from './doctor.js';

export { wecomProbe } from './probe.js';
export type { ProbeResult as WeComProbeResult } from './probe.js';

export {
  setWeComRuntime,
  getWeComRuntime,
  clearWeComRuntime,
} from './runtime.js';
export type { WeComRuntime, WeComRuntimeStatus } from './runtime.js';
