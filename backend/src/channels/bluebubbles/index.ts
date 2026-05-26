/**
 * channels/bluebubbles/index.ts - BlueBubbles 通道导出
 */

export {
  bluebubblesChannel,
  createBlueBubblesChannel,
  bluebubblesChannelPlugin,
} from './BlueBubblesChannel.js';

export {
  getDefaultBlueBubblesConfig,
  validateBlueBubblesConfig,
} from './config-schema.js';
export type { BlueBubblesConfig } from './config-schema.js';

export {
  registerBlueBubblesAccount,
  getBlueBubblesAccount,
  resolveBlueBubblesAccount,
  listBlueBubblesAccountIds,
  removeBlueBubblesAccount,
} from './accounts.js';
export type {
  BlueBubblesAccount,
  ResolvedBlueBubblesAccount,
} from './accounts.js';

export { BlueBubblesMonitor } from './monitor.js';
export { BLUEBUBBLES_TOOL_HINTS, buildBlueBubblesContext } from './runtime.js';
export type { BlueBubblesRuntimeContext } from './runtime.js';
export { diagnoseBlueBubbles } from './doctor.js';
export type {
  DiagnosisResult as BlueBubblesDiagnosisResult,
  DiagnosisCheck as BlueBubblesDiagnosisCheck,
  BlueBubblesDiagnosisContext,
} from './doctor.js';
export type { BlueBubblesProbe } from './probe.js';
