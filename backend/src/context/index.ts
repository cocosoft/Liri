/**
 * 上下文模块统一导出
 */
export { ContextBuilder, getContextBuilder } from './ContextBuilder';
export { getGitInfo, clearGitCache, type GitInfo } from './GitDetector';
export {
  readProjectFiles,
  readUserPyAppMd,
  type ProjectFiles,
} from './ProjectFileReader';
export {
  buildBasePrompt,
  buildUserContext,
  buildSystemContext,
  type SystemPromptParts,
} from './PromptTemplates';
export {
  ClaudeMdIntegrationImpl,
  createClaudeMdIntegration,
  type ClaudeMdConfig,
  type ClaudeMdRules,
} from './ClaudeMdIntegration';

// React上下文
export {
  StatsProvider,
  useStats,
  type StatsData,
  type StatsContextType,
} from './StatsContext';
export {
  MailboxProvider,
  useMailbox,
  type MailboxItem,
  type MailboxContextType,
} from './MailboxContext';
export { NotificationsProvider, useNotifications } from './notifications';
export {
  FPSMetricsProvider,
  useFPSMetrics,
  type FPSMetrics,
  type FPSMetricsContextType,
} from './FPSMetricsContext';
export {
  VoiceProvider,
  useVoice,
  type VoiceState,
  type VoiceContextType,
} from './VoiceContext';
