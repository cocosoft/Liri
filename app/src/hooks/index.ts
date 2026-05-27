/**
 * Hooks模块导出
 */

export * from './types';
export { HookExecutor } from './executors/HookExecutor';
export { CommandHookExecutor } from './executors/CommandHookExecutor';
export { PromptHookExecutor } from './executors/PromptHookExecutor';
export { HttpHookExecutor } from './executors/HttpHookExecutor';
export { AgentHookExecutor } from './executors/AgentHookExecutor';
export { StopHookExecutor } from './executors/StopHookExecutor';
export { HookChain } from './core/HookChain';
export { HookChainManager } from './core/HookChainManager';

export { useTerminalSize } from './useTerminalSize';

export {
  createInputBufferStore,
  getDefaultInputBuffer,
  type BufferEntry,
  type InputBufferState,
  type InputBufferActions,
  type InputBufferStore,
} from './useInputBuffer';

export {
  createElapsedTimeStore,
  getDefaultElapsedTime,
  type ElapsedTimeState,
  type ElapsedTimeActions,
  type ElapsedTimeStore,
} from './useElapsedTime';

export {
  createTimeoutStore,
  getDefaultTimeout,
  type TimeoutState,
  type TimeoutActions,
  type TimeoutStore,
} from './useTimeout';

export {
  createHistorySearchStore,
  getDefaultHistorySearch,
  type HistoryEntry,
  type HistorySearchState,
  type HistorySearchActions,
  type HistorySearchStore,
} from './useHistorySearch';

export {
  createCancelRequestStore,
  getDefaultCancelRequest,
  resetCancelRequestCache,
  type CancelRequestHandle,
} from './CancelRequest';

// 核心React Hooks
export { useCanUseTool } from './useCanUseTool';
export { useSettings } from './useSettings';
export { useMergedTools, useTools, useToolByName } from './useMergedTools';
export { useTypeahead, useCommandCompletion } from './useTypeahead';
export { useReplBridge } from './useReplBridge';
export { useTextInput, useSingleLineInput } from './useTextInput';

// 成本相关Hook
export {
  useCostSummary,
  useFormattedCostSummary,
  useTotalCost,
  useModelUsage,
} from '../cost/useCostSummary';

// 其他增强Hook
export { useVoice } from './useVoice';
export { usePrStatus, getPRCombinedStatus, canMergePR } from './usePrStatus';
export { useDiffData } from './useDiffData';
export { useMemoryUsage } from './useMemoryUsage';

// 通知Hooks
export {
  useStartupNotification,
  usePluginInstallationNotification,
  useTaskCompletionNotification,
} from './notifs';
