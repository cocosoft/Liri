/**
 * channels/wechat-bot/index.ts - 微信机器人通道导出
 */

export { ILinkClient } from './ilink-client.js';
export type {
  ILinkClientConfig,
  ILinkMessage,
  ILinkQRCode,
  ILinkCredentials,
} from './ilink-client.js';
export {
  wechatBotChannel,
  createWechatBotChannel,
  wechatBotChannelPlugin,
} from './WechatBotChannel.js';

export { getDefaultWechatBotConfig, validateWechatBotConfig } from './config-schema.js';
export type { WechatBotConfig } from './config-schema.js';

export {
  registerWechatBotAccount,
  getWechatBotAccount,
  resolveWechatBotAccount,
  listWechatBotAccountIds,
  removeWechatBotAccount,
} from './accounts.js';
export type { WechatBotAccount, ResolvedWechatBotAccount } from './accounts.js';

export { WechatBotMonitor } from './monitor.js';
export type {
  MonitorEvent as WechatBotMonitorEvent,
  MonitorStats as WechatBotMonitorStats,
} from './monitor.js';

export { diagnoseWechatBot } from './doctor.js';
export type {
  DiagnosisResult as WechatBotDiagnosisResult,
  WechatBotDiagnosisContext,
} from './doctor.js';

export { wechatBotProbe } from './probe.js';
export type { ProbeResult as WechatBotProbeResult } from './probe.js';

export {
  setWechatBotRuntime,
  getWechatBotRuntime,
  clearWechatBotRuntime,
} from './runtime.js';
export type { WechatBotRuntime, WechatBotRuntimeStatus } from './runtime.js';
