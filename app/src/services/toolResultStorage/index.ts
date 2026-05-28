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
export type {
  ContentReplacementState,
  ContentReplacementRecord,
  ToolResultReplacementRecord,
  PersistedToolResult,
  PersistToolResultError,
  ToolResultCandidate,
  CandidatePartition,
} from './types';

export {
  BYTES_PER_TOKEN,
  DEFAULT_MAX_RESULT_SIZE_CHARS,
  MAX_TOOL_RESULT_BYTES,
  MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
  TOOL_RESULTS_SUBDIR,
  PERSISTED_OUTPUT_TAG,
  PERSISTED_OUTPUT_CLOSING_TAG,
  TOOL_RESULT_CLEARED_MESSAGE,
  PREVIEW_SIZE_BYTES,
} from './types';

export {
  createContentReplacementState,
  cloneContentReplacementState,
  generatePreview,
  buildLargeToolResultMessage,
  formatFileSize,
  contentSize,
  isToolResultContentEmpty,
  isPersistError,
  partitionCandidates,
  applyContentReplacement,
  provisionContentReplacementState,
  reconstructContentReplacementState,
  getPerMessageBudgetLimit,
} from './ContentReplacementStore';

export {
  applyToolResultBudget,
  enforceToolResultBudget,
  estimateTokenSavings,
} from './ToolResultBudget';

export type { ToolResultBudgetOptions } from './ToolResultBudget';

export {
  serializeReplacementState,
  deserializeReplacementState,
  serializeReplacementRecord,
  deserializeReplacementRecord,
} from './StorageSerializer';

export {
  createToolResultStorageHook,
  createSessionRestoreHook,
} from './ToolResultStorageHook';

export type {
  ToolExecutionWithStorage,
  SessionRestoreResult,
} from './ToolResultStorageHook';
