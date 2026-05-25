export { createMatrixChannel, matrixChannelPlugin } from './MatrixChannel.js';
export {
  getDefaultMatrixConfig,
  validateMatrixConfig,
} from './config-schema.js';
export type { MatrixConfig } from './config-schema.js';
export {
  registerMatrixAccount,
  getMatrixAccount,
  resolveMatrixAccount,
  listMatrixAccountIds,
  removeMatrixAccount,
} from './accounts.js';
export type { MatrixAccount, ResolvedMatrixAccount } from './accounts.js';
export { MatrixMonitor } from './monitor.js';
export type {
  MonitorEvent as MatrixMonitorEvent,
  MonitorStats as MatrixMonitorStats,
} from './monitor.js';
export { diagnoseMatrix } from './doctor.js';
export type {
  DiagnosisResult as MatrixDiagnosisResult,
  MatrixDiagnosisContext,
} from './doctor.js';
export { matrixProbe } from './probe.js';
export type { ProbeResult as MatrixProbeResult } from './probe.js';
export {
  normalizeMatrixApproverId,
  resolveMatrixApprovers,
  isMatrixSenderAuthorized,
} from './approval-auth.js';
export type {
  MatrixApproverInfo,
  MatrixApprovalAuthConfig,
  MatrixApprovalAuthResult,
} from './approval-auth.js';
export { MatrixStreamMessage } from './streaming-message.js';
export type {
  MatrixStreamState,
  MatrixStreamOptions,
} from './streaming-message.js';
export { setMatrixRuntime, getMatrixRuntime, clearMatrixRuntime } from './runtime.js';
export type {
  MatrixRuntime,
  MatrixRuntimeStatus,
} from './runtime.js';
