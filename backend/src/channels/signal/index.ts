/**
 * channels/signal/index.ts - Signal 通道导出
 */

export {
  SignalChannel,
  signalChannel,
  createSignalChannel,
  signalChannelPlugin,
} from './SignalChannel.js';
export type { SignalConfig, SignalMessage } from './SignalChannel.js';

export { getDefaultSignalConfig, validateSignalConfig } from './config-schema.js';
export type { SignalConfig as SignalChannelConfig } from './config-schema.js';

export {
  registerSignalAccount,
  getSignalAccount,
  resolveSignalAccount,
  listSignalAccountIds,
  removeSignalAccount,
} from './accounts.js';
export type { SignalAccount, ResolvedSignalAccount } from './accounts.js';

export { SignalMonitor } from './monitor.js';
export type {
  MonitorEvent as SignalMonitorEvent,
  MonitorStats as SignalMonitorStats,
} from './monitor.js';

export { diagnoseSignal } from './doctor.js';
export type {
  DiagnosisResult as SignalDiagnosisResult,
  SignalDiagnosisContext,
} from './doctor.js';

export { signalProbe } from './probe.js';
export type { ProbeResult as SignalProbeResult } from './probe.js';

export {
  setSignalRuntime,
  getSignalRuntime,
  clearSignalRuntime,
} from './runtime.js';
export type { SignalRuntime, SignalRuntimeStatus } from './runtime.js';
