export {
  discordChannel,
  createDiscordChannel,
  discordChannelPlugin,
  buildDiscordEmbed,
} from './DiscordChannel';
export {
  getDefaultDiscordConfig,
  validateDiscordConfig,
} from './config-schema';
export type { DiscordConfig } from './config-schema';
export {
  registerDiscordAccount,
  getDiscordAccount,
  resolveDiscordAccount,
  listDiscordAccountIds,
  removeDiscordAccount,
} from './accounts';
export type { DiscordAccount, ResolvedDiscordAccount } from './accounts';
export { DiscordMonitor } from './monitor';
export type {
  MonitorEvent as DiscordMonitorEvent,
  MonitorStats as DiscordMonitorStats,
} from './monitor';
export { diagnoseDiscord } from './doctor';
export type {
  DiagnosisResult as DiscordDiagnosisResult,
  DiscordDiagnosisContext,
} from './doctor';
export { discordProbe } from './probe';
export type { ProbeResult as DiscordProbeResult } from './probe';
export {
  normalizeDiscordApproverId,
  resolveDiscordApprovers,
  isDiscordSenderAuthorized,
} from './approval-auth';
export type {
  DiscordApproverInfo,
  DiscordApprovalAuthConfig,
  DiscordApprovalAuthResult,
} from './approval-auth';
export { DiscordStreamMessage } from './streaming-message';
export type {
  DiscordStreamState,
  DiscordStreamOptions,
} from './streaming-message';
export { setDiscordRuntime, getDiscordRuntime, clearDiscordRuntime } from './runtime';
export type {
  DiscordRuntime,
  DiscordRuntimeStatus,
} from './runtime';
