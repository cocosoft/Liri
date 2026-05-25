export { createMSTeamsChannel, msTeamsChannelPlugin } from './MSTeamsChannel.js';
export {
  getDefaultMSTeamsConfig,
  validateMSTeamsConfig,
} from './config-schema.js';
export type { MSTeamsConfig } from './config-schema.js';
export {
  registerMSTeamsAccount,
  getMSTeamsAccount,
  resolveMSTeamsAccount,
  listMSTeamsAccountIds,
  removeMSTeamsAccount,
} from './accounts.js';
export type { MSTeamsAccount, ResolvedMSTeamsAccount } from './accounts.js';
export { MSTeamsMonitor } from './monitor.js';
export type {
  MonitorEvent as MSTeamsMonitorEvent,
  MonitorStats as MSTeamsMonitorStats,
} from './monitor.js';
export { diagnoseMSTeams } from './doctor.js';
export type {
  DiagnosisResult as MSTeamsDiagnosisResult,
  MSTeamsDiagnosisContext,
} from './doctor.js';
export { msteamsProbe } from './probe.js';
export type { ProbeResult as MSTeamsProbeResult } from './probe.js';
export {
  normalizeMSTeamsApproverId,
  resolveMSTeamsApprovers,
  isMSTeamsSenderAuthorized,
} from './approval-auth.js';
export type {
  MSTeamsApproverInfo,
  MSTeamsApprovalAuthConfig,
  MSTeamsApprovalAuthResult,
} from './approval-auth.js';
export { TeamsHttpStream } from './streaming-message.js';
export type {
  TeamsStreamState,
  TeamsStreamOptions,
} from './streaming-message.js';
export { setMSTeamsRuntime, getMSTeamsRuntime, clearMSTeamsRuntime } from './runtime.js';
export type {
  MSTeamsRuntime,
  MSTeamsRuntimeStatus,
} from './runtime.js';
