/**
 * channels/twitter/index.ts - Twitter/X 通道导出
 */

export {
  TwitterChannel,
  twitterChannel,
  createTwitterChannel,
  twitterChannelPlugin,
} from './TwitterChannel.js';
export type { TwitterConfig, TwitterMessage } from './TwitterChannel.js';

export { getDefaultTwitterConfig, validateTwitterConfig } from './config-schema.js';
export type { TwitterConfig as TwitterChannelConfig } from './config-schema.js';

export {
  registerTwitterAccount,
  getTwitterAccount,
  resolveTwitterAccount,
  listTwitterAccountIds,
  removeTwitterAccount,
} from './accounts.js';
export type { TwitterAccount, ResolvedTwitterAccount } from './accounts.js';

export { TwitterMonitor } from './monitor.js';
export type {
  MonitorEvent as TwitterMonitorEvent,
  MonitorStats as TwitterMonitorStats,
} from './monitor.js';

export { diagnoseTwitter } from './doctor.js';
export type {
  DiagnosisResult as TwitterDiagnosisResult,
  TwitterDiagnosisContext,
} from './doctor.js';

export { twitterProbe } from './probe.js';
export type { ProbeResult as TwitterProbeResult } from './probe.js';

export {
  setTwitterRuntime,
  getTwitterRuntime,
  clearTwitterRuntime,
} from './runtime.js';
export type { TwitterRuntime, TwitterRuntimeStatus } from './runtime.js';
