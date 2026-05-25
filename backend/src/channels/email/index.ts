/**
 * channels/email/index.ts - Email 通道导出
 */

export {
  EmailChannel,
  emailChannel,
  createEmailChannel,
  emailChannelPlugin,
} from './EmailChannel.js';
export type { EmailConfig, EmailMessage } from './EmailChannel.js';

export { getDefaultEmailConfig, validateEmailConfig } from './config-schema.js';
export type { EmailConfig as EmailSchemaConfig } from './config-schema.js';

export {
  registerEmailAccount,
  getEmailAccount,
  resolveEmailAccount,
  listEmailAccountIds,
  removeEmailAccount,
} from './accounts.js';
export type {
  EmailAccount,
  ResolvedEmailAccount,
} from './accounts.js';

export { EmailMonitor } from './monitor.js';

export { diagnoseEmail } from './doctor.js';
export type { DiagnosisResult, DiagnosisCheck, EmailDiagnosisContext } from './doctor.js';

export { emailProbe } from './probe.js';
export type { ProbeResult } from './probe.js';

export {
  setEmailRuntime,
  getEmailRuntime,
  clearEmailRuntime,
} from './runtime.js';
export type { EmailRuntime, EmailRuntimeStatus } from './runtime.js';
