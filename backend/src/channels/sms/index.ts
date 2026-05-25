/**
 * channels/sms/index.ts - SMS 通道导出
 */

export {
  SmsChannel,
  smsChannel,
  createSmsChannel,
  smsChannelPlugin,
} from './SmsChannel.js';
export type { SmsConfig, SmsMessage } from './SmsChannel.js';

export { getDefaultSmsConfig, validateSmsConfig } from './config-schema.js';
export type { SmsConfig as SmsChannelConfig } from './config-schema.js';

export {
  registerSmsAccount,
  getSmsAccount,
  resolveSmsAccount,
  listSmsAccountIds,
  removeSmsAccount,
} from './accounts.js';
export type { SmsAccount, ResolvedSmsAccount } from './accounts.js';

export { SmsMonitor } from './monitor.js';
export type {
  MonitorEvent as SmsMonitorEvent,
  MonitorStats as SmsMonitorStats,
} from './monitor.js';

export { diagnoseSms } from './doctor.js';
export type {
  DiagnosisResult as SmsDiagnosisResult,
  SmsDiagnosisContext,
} from './doctor.js';

export { smsProbe } from './probe.js';
export type { ProbeResult as SmsProbeResult } from './probe.js';

export { setSmsRuntime, getSmsRuntime, clearSmsRuntime } from './runtime.js';
export type { SmsRuntime, SmsRuntimeStatus } from './runtime.js';
