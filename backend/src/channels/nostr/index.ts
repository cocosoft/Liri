/**
 * channels/nostr/index.ts - Nostr 通道导出
 */

export {
  NostrChannel,
  nostrChannel,
  createNostrChannel,
  nostrChannelPlugin,
} from './NostrChannel.js';
export type { NostrConfig, NostrEvent } from './NostrChannel.js';

export { getDefaultNostrConfig, validateNostrConfig } from './config-schema.js';
export type { NostrConfig as NostrChannelConfig } from './config-schema.js';

export {
  registerNostrAccount,
  getNostrAccount,
  resolveNostrAccount,
  listNostrAccountIds,
  removeNostrAccount,
} from './accounts.js';
export type { NostrAccount, ResolvedNostrAccount } from './accounts.js';

export { NostrMonitor } from './monitor.js';
export type {
  MonitorEvent as NostrMonitorEvent,
  MonitorStats as NostrMonitorStats,
} from './monitor.js';

export { diagnoseNostr } from './doctor.js';
export type {
  DiagnosisResult as NostrDiagnosisResult,
  NostrDiagnosisContext,
} from './doctor.js';

export { nostrProbe } from './probe.js';
export type { ProbeResult as NostrProbeResult } from './probe.js';

export {
  setNostrRuntime,
  getNostrRuntime,
  clearNostrRuntime,
} from './runtime.js';
export type { NostrRuntime, NostrRuntimeStatus } from './runtime.js';
