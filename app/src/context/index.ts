// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
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
  ProjectRulesLoaderImpl,
  createProjectRulesLoader,
  filterInjectedMemoryFiles,
  type RulesConfig,
  type ProjectRules,
  type MemoryFileInfo,
  type MemoryType,
} from './ProjectRulesLoader';

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

// P3-6: 上下文引擎插件导出
export { ContextEngineRegistry } from './ContextEnginePlugin';
export type {
  ContextEnginePlugin,
  CompressionRequest,
  CompressionResult,
} from './ContextEnginePlugin';

export * from './EffectScope.js';

export * from './DependencyRegistry.js';

// 2026-08-29 R03-002 收敛：compaction / window / async 统一出口
export { compactionOrchestrator } from './compaction/CompactionOrchestrator';
export { autoCompactionPolicy } from './compaction/AutoCompactionPolicy';
export {
  compactionMetricsTracker,
  type ContextSnapshot,
} from './compaction/CompactionMetrics';
export {
  resolveContextWindow,
  resolveContextWindowAsync,
  parsePromptTokensFromError,
  parseContextLimitFromError,
  calibrateContextWindow,
} from './window/ContextWindowResolver';
export type { CompactionContext } from './compaction/CompactionOrchestrator';
export { asyncContextStorage } from './AsyncContextStorage';
