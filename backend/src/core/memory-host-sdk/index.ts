export type {
  MemorySearchResult,
  MemorySearchManager,
  MemorySearchRuntimeDebug,
  MemoryProviderStatus,
  MemoryReadResult,
  MemorySource,
  MemorySyncProgressUpdate,
  MemoryEmbeddingProbeResult,
} from "./types.js";

export {
  hasConfiguredMemorySecretInput,
  resolveMemorySecretInputString,
} from "./secret.js";

export {
  resolveMemoryVectorState,
  resolveMemoryFtsState,
  resolveMemoryCacheSummary,
  resolveMemoryCacheState,
} from "./status.js";
export type { Tone } from "./status.js";

export {
  extractKeywords,
  isQueryStopWordToken,
} from "./query.js";

export {
  appendMemoryHostEvent,
  readMemoryHostEvents,
  resolveMemoryHostEventLogPath,
} from "./events.js";
export type {
  MemoryHostEvent,
  MemoryHostRecallRecordedEvent,
  MemoryHostPromotionAppliedEvent,
  MemoryHostDreamCompletedEvent,
} from "./events.js";

export {
  DEFAULT_MEMORY_DREAMING_ENABLED,
  DEFAULT_MEMORY_DREAMING_TIMEZONE,
  DEFAULT_MEMORY_DREAMING_VERBOSE_LOGGING,
  DEFAULT_MEMORY_DREAMING_STORAGE_MODE,
  DEFAULT_MEMORY_DREAMING_SEPARATE_REPORTS,
  DEFAULT_MEMORY_DREAMING_FREQUENCY,
  DEFAULT_MEMORY_DREAMING_PLUGIN_ID,
  DEFAULT_MEMORY_LIGHT_DREAMING_LOOKBACK_DAYS,
  DEFAULT_MEMORY_LIGHT_DREAMING_LIMIT,
  DEFAULT_MEMORY_LIGHT_DREAMING_DEDUPE_SIMILARITY,
  DEFAULT_MEMORY_DEEP_DREAMING_LIMIT,
  DEFAULT_MEMORY_DEEP_DREAMING_MIN_SCORE,
  DEFAULT_MEMORY_DEEP_DREAMING_MIN_RECALL_COUNT,
  DEFAULT_MEMORY_DEEP_DREAMING_MIN_UNIQUE_QUERIES,
  DEFAULT_MEMORY_DEEP_DREAMING_RECENCY_HALF_LIFE_DAYS,
  DEFAULT_MEMORY_DEEP_DREAMING_MAX_AGE_DAYS,
  DEFAULT_MEMORY_REM_DREAMING_LOOKBACK_DAYS,
  DEFAULT_MEMORY_REM_DREAMING_LIMIT,
  DEFAULT_MEMORY_REM_DREAMING_MIN_PATTERN_STRENGTH,
  resolveMemoryDreamingConfig,
  resolveMemoryDreamingPluginId,
  resolveMemoryDreamingPluginConfig,
} from "./dreaming.js";
export type {
  MemoryDreamingConfig,
  MemoryDreamingPhaseName,
  MemoryDreamingSpeed,
  MemoryDreamingThinking,
  MemoryDreamingBudget,
  MemoryDreamingStorageMode,
  MemoryDreamingExecutionConfig,
  MemoryDreamingStorageConfig,
  MemoryLightDreamingConfig,
  MemoryDeepDreamingConfig,
  MemoryRemDreamingConfig,
  MemoryDeepDreamingRecoveryConfig,
  MemoryLightDreamingSource,
  MemoryDeepDreamingSource,
  MemoryRemDreamingSource,
} from "./dreaming.js";

export {
  MEMORY_HOST_EVENT_LOG_RELATIVE_PATH,
} from "./events.js";
