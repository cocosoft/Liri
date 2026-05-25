/**
 * channels/wechat/index.ts - 微信通道导出
 */

export {
  wechatChannel,
  createWechatChannel,
  wechatChannelPlugin,
  parseWechatXML,
  buildWechatReply,
  WechatCrypto,
} from './WechatChannel.js';

export { getDefaultWechatConfig, validateWechatConfig } from './config-schema.js';
export type { WechatConfig } from './config-schema.js';

export {
  registerWechatAccount,
  getWechatAccount,
  resolveWechatAccount,
  listWechatAccountIds,
  removeWechatAccount,
} from './accounts.js';
export type { WechatAccount, ResolvedWechatAccount } from './accounts.js';

export { WechatMonitor } from './monitor.js';
export type {
  MonitorEvent as WechatMonitorEvent,
  MonitorStats as WechatMonitorStats,
} from './monitor.js';

export { diagnoseWechat } from './doctor.js';
export type {
  DiagnosisResult as WechatDiagnosisResult,
  WechatDiagnosisContext,
} from './doctor.js';

export { wechatProbe } from './probe.js';
export type { ProbeResult as WechatProbeResult } from './probe.js';

export {
  setWechatRuntime,
  getWechatRuntime,
  clearWechatRuntime,
} from './runtime.js';
export type { WechatRuntime, WechatRuntimeStatus } from './runtime.js';
