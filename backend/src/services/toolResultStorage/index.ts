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
