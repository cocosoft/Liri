export { createIrcChannel, ircChannelPlugin } from './IrcChannel.js';
export {
  getDefaultIrcConfig,
  validateIrcConfig,
} from './config-schema.js';
export type { IrcConfig } from './config-schema.js';
export {
  registerIrcAccount,
  getIrcAccount,
  resolveIrcAccount,
  listIrcAccountIds,
  removeIrcAccount,
} from './accounts.js';
export type { IrcAccount, ResolvedIrcAccount } from './accounts.js';
export { IrcMonitor } from './monitor.js';
export type {
  MonitorEvent as IrcMonitorEvent,
  MonitorStats as IrcMonitorStats,
} from './monitor.js';
export { diagnoseIrc } from './doctor.js';
export type {
  DiagnosisResult as IrcDiagnosisResult,
  IrcDiagnosisContext,
} from './doctor.js';
export { ircProbe } from './probe.js';
export type { ProbeResult as IrcProbeResult } from './probe.js';
export { setIrcRuntime, getIrcRuntime, clearIrcRuntime } from './runtime.js';
export type {
  IrcRuntime,
  IrcRuntimeStatus,
} from './runtime.js';
