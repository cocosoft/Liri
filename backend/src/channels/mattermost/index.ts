/**
 * channels/mattermost/index.ts - Mattermost 通道导出
 */

export {
  mattermostChannel,
  createMattermostChannel,
  mattermostChannelPlugin,
} from './MattermostChannel.js';

export {
  getDefaultMattermostConfig,
  validateMattermostConfig,
} from './config-schema.js';
export type { MattermostConfig } from './config-schema.js';

export {
  registerMattermostAccount,
  getMattermostAccount,
  resolveMattermostAccount,
  listMattermostAccountIds,
  removeMattermostAccount,
} from './accounts.js';
export type { MattermostAccount, ResolvedMattermostAccount } from './accounts.js';

export { MattermostMonitor } from './monitor.js';
export { MATTERMOST_TOOL_HINTS, buildMattermostContext } from './runtime.js';
export type { MattermostRuntimeContext } from './runtime.js';
export { diagnoseMattermost } from './doctor.js';
export type {
  DiagnosisResult as MattermostDiagnosisResult,
  DiagnosisCheck as MattermostDiagnosisCheck,
  MattermostDiagnosisContext,
} from './doctor.js';
export type { MattermostProbe } from './probe.js';
