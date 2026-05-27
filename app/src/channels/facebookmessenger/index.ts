/**
 * channels/facebookmessenger/index.ts - Facebook Messenger 通道导出
 */

export {
  FacebookMessengerChannel,
  facebookMessengerChannel,
  createFacebookMessengerChannel,
  facebookMessengerChannelPlugin,
} from './FacebookMessengerChannel.js';
export type {
  FacebookMessengerConfig as FacebookMessengerChannelConfig,
  FacebookMessengerMessage as FacebookMessengerChannelMessage,
} from './FacebookMessengerChannel.js';

export {
  getDefaultFacebookMessengerConfig,
  validateFacebookMessengerConfig,
} from './config-schema.js';
export type { FacebookMessengerConfig } from './config-schema.js';

export {
  registerFacebookMessengerAccount,
  getFacebookMessengerAccount,
  resolveFacebookMessengerAccount,
  listFacebookMessengerAccountIds,
  removeFacebookMessengerAccount,
} from './accounts.js';
export type {
  FacebookMessengerAccount,
  ResolvedFacebookMessengerAccount,
} from './accounts.js';

export { FacebookMessengerMonitor } from './monitor.js';
export type {
  MonitorEvent as FacebookMessengerMonitorEvent,
  MonitorStats as FacebookMessengerMonitorStats,
} from './monitor.js';

export { diagnoseFacebookMessenger } from './doctor.js';
export type {
  DiagnosisResult as FacebookMessengerDiagnosisResult,
  FacebookMessengerDiagnosisContext,
} from './doctor.js';

export { facebookMessengerProbe } from './probe.js';
export type { ProbeResult as FacebookMessengerProbeResult } from './probe.js';

export {
  setFacebookMessengerRuntime,
  getFacebookMessengerRuntime,
  clearFacebookMessengerRuntime,
} from './runtime.js';
export type {
  FacebookMessengerRuntime,
  FacebookMessengerRuntimeStatus,
} from './runtime.js';
