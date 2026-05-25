/**
 * channels/whatsapp/index.ts - WhatsApp 通道导出
 */

export {
  WhatsAppChannel,
  whatsAppChannel,
  createWhatsAppChannel,
  whatsAppChannelPlugin,
} from './WhatsAppChannel.js';
export type { WhatsAppConfig, WhatsAppMessage } from './WhatsAppChannel.js';

export { getDefaultWhatsAppConfig, validateWhatsAppConfig } from './config-schema.js';
export type { WhatsAppConfig as WhatsAppChannelConfig } from './config-schema.js';

export {
  registerWhatsAppAccount,
  getWhatsAppAccount,
  resolveWhatsAppAccount,
  listWhatsAppAccountIds,
  removeWhatsAppAccount,
} from './accounts.js';
export type { WhatsAppAccount, ResolvedWhatsAppAccount } from './accounts.js';

export { WhatsAppMonitor } from './monitor.js';
export type {
  MonitorEvent as WhatsAppMonitorEvent,
  MonitorStats as WhatsAppMonitorStats,
} from './monitor.js';

export { diagnoseWhatsApp } from './doctor.js';
export type {
  DiagnosisResult as WhatsAppDiagnosisResult,
  WhatsAppDiagnosisContext,
} from './doctor.js';

export { whatsappProbe } from './probe.js';
export type { ProbeResult as WhatsAppProbeResult } from './probe.js';

export {
  setWhatsAppRuntime,
  getWhatsAppRuntime,
  clearWhatsAppRuntime,
} from './runtime.js';
export type { WhatsAppRuntime, WhatsAppRuntimeStatus } from './runtime.js';
