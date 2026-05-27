/**
 * channels/dingtalk/index.ts - 钉钉通道导出
 */

export {
  dingtalkChannel,
  createDingtalkChannel,
  dingtalkChannelPlugin,
} from './DingTalkChannel.js';

export {
  getDefaultDingTalkConfig,
  validateDingTalkConfig,
} from './config-schema.js';
export type { DingTalkConfig } from './config-schema.js';

export {
  registerDingTalkAccount,
  getDingTalkAccount,
  resolveDingTalkAccount,
  listDingTalkAccountIds,
  removeDingTalkAccount,
} from './accounts.js';
export type { DingTalkAccount, ResolvedDingTalkAccount } from './accounts.js';

export { DingTalkMonitor } from './monitor.js';
export type {
  MonitorEvent as DingTalkMonitorEvent,
  MonitorStats as DingTalkMonitorStats,
} from './monitor.js';

export { diagnoseDingTalk } from './doctor.js';
export type {
  DiagnosisResult as DingTalkDiagnosisResult,
  DingTalkDiagnosisContext,
} from './doctor.js';

export { dingTalkProbe } from './probe.js';
export type { ProbeResult as DingTalkProbeResult } from './probe.js';

export {
  setDingTalkRuntime,
  getDingTalkRuntime,
  clearDingTalkRuntime,
} from './runtime.js';
export type { DingTalkRuntime, DingTalkRuntimeStatus } from './runtime.js';
