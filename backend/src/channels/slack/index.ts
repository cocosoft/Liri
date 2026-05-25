/**
 * channels/slack/index.ts - Slack 通道导出
 */

export {
  SlackChannel,
  slackChannel,
  createSlackChannel,
  slackChannelPlugin,
} from './SlackChannel.js';
export type { SlackConfig, SlackMessage } from './SlackChannel.js';

export { getDefaultSlackConfig, validateSlackConfig } from './config-schema.js';
export type { SlackConfig as SlackChannelConfig } from './config-schema.js';

export {
  registerSlackAccount,
  getSlackAccount,
  resolveSlackAccount,
  listSlackAccountIds,
  removeSlackAccount,
} from './accounts.js';
export type { SlackAccount, ResolvedSlackAccount } from './accounts.js';

export { SlackMonitor } from './monitor.js';
export type {
  MonitorEvent as SlackMonitorEvent,
  MonitorStats as SlackMonitorStats,
} from './monitor.js';

export { diagnoseSlack } from './doctor.js';
export type {
  DiagnosisResult as SlackDiagnosisResult,
  SlackDiagnosisContext,
} from './doctor.js';

export { slackProbe } from './probe.js';
export type { ProbeResult as SlackProbeResult } from './probe.js';

export {
  setSlackRuntime,
  getSlackRuntime,
  clearSlackRuntime,
} from './runtime.js';
export type { SlackRuntime, SlackRuntimeStatus } from './runtime.js';
