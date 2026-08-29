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
} from '@modules/cost';

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

// 2026-08-29 R03-002 收敛：managers / cli / postSampling 统一出口
export { ToolHookManager } from './managers/ToolHookManager';
export { PostSamplingHookManager } from './managers/PostSamplingHookManager';
export { createPostSamplingHookManager } from './managers/PostSamplingHookManager';
export { createPostCallSummaryHook } from './postSampling/PostCallSummaryHook';
export { initHooksCommand } from './cli/hooks';
