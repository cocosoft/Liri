export const DEFAULT_MEMORY_DREAMING_ENABLED = false;
export const DEFAULT_MEMORY_DREAMING_TIMEZONE = undefined;
export const DEFAULT_MEMORY_DREAMING_VERBOSE_LOGGING = false;
export const DEFAULT_MEMORY_DREAMING_STORAGE_MODE = "separate";
export const DEFAULT_MEMORY_DREAMING_SEPARATE_REPORTS = false;
export const DEFAULT_MEMORY_DREAMING_FREQUENCY = "0 3 * * *";
export const DEFAULT_MEMORY_DREAMING_PLUGIN_ID = "memory-core";
export const MANAGED_MEMORY_DREAMING_CRON_NAME = "Memory Dreaming Promotion";
export const MANAGED_MEMORY_DREAMING_CRON_TAG = "[managed-by=memory-core.short-term-promotion]";
export const MEMORY_DREAMING_SYSTEM_EVENT_TEXT =
  "__openclaw_memory_core_short_term_promotion_dream__";
export const LEGACY_MEMORY_LIGHT_DREAMING_CRON_NAME = "Memory Light Dreaming";
export const LEGACY_MEMORY_LIGHT_DREAMING_CRON_TAG = "[managed-by=memory-core.dreaming.light]";
export const LEGACY_MEMORY_LIGHT_DREAMING_EVENT_TEXT = "__openclaw_memory_core_light_sleep__";
export const LEGACY_MEMORY_REM_DREAMING_CRON_NAME = "Memory REM Dreaming";
export const LEGACY_MEMORY_REM_DREAMING_CRON_TAG = "[managed-by=memory-core.dreaming.rem]";
export const LEGACY_MEMORY_REM_DREAMING_EVENT_TEXT = "__openclaw_memory_core_rem_sleep__";

export const DEFAULT_MEMORY_LIGHT_DREAMING_CRON_EXPR = "0 */6 * * *";
export const DEFAULT_MEMORY_LIGHT_DREAMING_LOOKBACK_DAYS = 2;
export const DEFAULT_MEMORY_LIGHT_DREAMING_LIMIT = 100;
export const DEFAULT_MEMORY_LIGHT_DREAMING_DEDUPE_SIMILARITY = 0.9;

export const DEFAULT_MEMORY_DEEP_DREAMING_CRON_EXPR = "0 3 * * *";
export const DEFAULT_MEMORY_DEEP_DREAMING_LIMIT = 10;
export const DEFAULT_MEMORY_DEEP_DREAMING_MIN_SCORE = 0.8;
export const DEFAULT_MEMORY_DEEP_DREAMING_MIN_RECALL_COUNT = 3;
export const DEFAULT_MEMORY_DEEP_DREAMING_MIN_UNIQUE_QUERIES = 3;
export const DEFAULT_MEMORY_DEEP_DREAMING_RECENCY_HALF_LIFE_DAYS = 14;
export const DEFAULT_MEMORY_DEEP_DREAMING_MAX_AGE_DAYS = 30;

export const DEFAULT_MEMORY_DEEP_DREAMING_RECOVERY_ENABLED = true;
export const DEFAULT_MEMORY_DEEP_DREAMING_RECOVERY_TRIGGER_BELOW_HEALTH = 0.35;
export const DEFAULT_MEMORY_DEEP_DREAMING_RECOVERY_LOOKBACK_DAYS = 30;
export const DEFAULT_MEMORY_DEEP_DREAMING_RECOVERY_MAX_CANDIDATES = 20;
export const DEFAULT_MEMORY_DEEP_DREAMING_RECOVERY_MIN_CONFIDENCE = 0.9;
export const DEFAULT_MEMORY_DEEP_DREAMING_RECOVERY_AUTO_WRITE_MIN_CONFIDENCE = 0.97;

export const DEFAULT_MEMORY_REM_DREAMING_CRON_EXPR = "0 5 * * 0";
export const DEFAULT_MEMORY_REM_DREAMING_LOOKBACK_DAYS = 7;
export const DEFAULT_MEMORY_REM_DREAMING_LIMIT = 10;
export const DEFAULT_MEMORY_REM_DREAMING_MIN_PATTERN_STRENGTH = 0.75;

export const DEFAULT_MEMORY_DREAMING_SPEED = "balanced";
export const DEFAULT_MEMORY_DREAMING_THINKING = "medium";
export const DEFAULT_MEMORY_DREAMING_BUDGET = "medium";

export type MemoryDreamingSpeed = "fast" | "balanced" | "slow";
export type MemoryDreamingThinking = "low" | "medium" | "high";
export type MemoryDreamingBudget = "cheap" | "medium" | "expensive";
export type MemoryDreamingStorageMode = "inline" | "separate" | "both";

export type MemoryLightDreamingSource = "daily" | "sessions" | "recall";
export type MemoryDeepDreamingSource = "daily" | "memory" | "sessions" | "logs" | "recall";
export type MemoryRemDreamingSource = "memory" | "daily" | "deep";

export type MemoryDreamingExecutionConfig = {
  speed: MemoryDreamingSpeed;
  thinking: MemoryDreamingThinking;
  budget: MemoryDreamingBudget;
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
};

export type MemoryDreamingStorageConfig = {
  mode: MemoryDreamingStorageMode;
  separateReports: boolean;
};

export type MemoryLightDreamingConfig = {
  enabled: boolean;
  cron: string;
  lookbackDays: number;
  limit: number;
  dedupeSimilarity: number;
  sources: MemoryLightDreamingSource[];
  execution: MemoryDreamingExecutionConfig;
};

export type MemoryDeepDreamingRecoveryConfig = {
  enabled: boolean;
  triggerBelowHealth: number;
  lookbackDays: number;
  maxRecoveredCandidates: number;
  minRecoveryConfidence: number;
  autoWriteMinConfidence: number;
};

export type MemoryDeepDreamingConfig = {
  enabled: boolean;
  cron: string;
  limit: number;
  minScore: number;
  minRecallCount: number;
  minUniqueQueries: number;
  recencyHalfLifeDays: number;
  maxAgeDays?: number;
  sources: MemoryDeepDreamingSource[];
  recovery: MemoryDeepDreamingRecoveryConfig;
  execution: MemoryDreamingExecutionConfig;
};

export type MemoryRemDreamingConfig = {
  enabled: boolean;
  cron: string;
  lookbackDays: number;
  limit: number;
  minPatternStrength: number;
  sources: MemoryRemDreamingSource[];
  execution: MemoryDreamingExecutionConfig;
};

export type MemoryDreamingPhaseName = "light" | "deep" | "rem";

export type MemoryDreamingConfig = {
  enabled: boolean;
  frequency: string;
  timezone?: string;
  verboseLogging: boolean;
  storage: MemoryDreamingStorageConfig;
  execution: {
    defaults: MemoryDreamingExecutionConfig;
  };
  phases: {
    light: MemoryLightDreamingConfig;
    deep: MemoryDeepDreamingConfig;
    rem: MemoryRemDreamingConfig;
  };
};

const DEFAULT_MEMORY_LIGHT_DREAMING_SOURCES: MemoryLightDreamingSource[] = [
  "daily", "sessions", "recall",
];
const DEFAULT_MEMORY_DEEP_DREAMING_SOURCES: MemoryDeepDreamingSource[] = [
  "daily", "memory", "sessions", "logs", "recall",
];
const DEFAULT_MEMORY_REM_DREAMING_SOURCES: MemoryRemDreamingSource[] = ["memory", "daily", "deep"];

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const lower = value.toLowerCase().trim();
    if (lower === "true") {
      return true;
    }
    if (lower === "false") {
      return false;
    }
  }
  return fallback;
}

function normalizeTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNonNegativeInt(value: unknown, fallback: number): number {
  const num = typeof value === "string" ? Number(value) : Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  const floored = Math.floor(num);
  return floored >= 0 ? floored : fallback;
}

function normalizeOptionalPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const num = typeof value === "string" ? Number(value) : Number(value);
  if (!Number.isFinite(num)) {
    return undefined;
  }
  const floored = Math.floor(num);
  return floored > 0 ? floored : undefined;
}

function normalizeScore(value: unknown, fallback: number): number {
  const num = typeof value === "string" ? Number(value) : Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 1) {
    return fallback;
  }
  return num;
}

function normalizeSpeed(value: unknown): MemoryDreamingSpeed | undefined {
  if (value === "fast" || value === "balanced" || value === "slow") {
    return value;
  }
  return undefined;
}

function normalizeThinking(value: unknown): MemoryDreamingThinking | undefined {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return undefined;
}

function normalizeBudget(value: unknown): MemoryDreamingBudget | undefined {
  if (value === "cheap" || value === "medium" || value === "expensive") {
    return value;
  }
  return undefined;
}

function normalizeStorageMode(value: unknown): MemoryDreamingStorageMode {
  if (value === "inline" || value === "separate" || value === "both") {
    return value;
  }
  return DEFAULT_MEMORY_DREAMING_STORAGE_MODE;
}

function resolveExecutionConfig(
  value: Record<string, unknown> | undefined,
  fallback: MemoryDreamingExecutionConfig,
): MemoryDreamingExecutionConfig {
  if (!value) {
    return { ...fallback };
  }

  const model = normalizeTrimmedString(value.model) ?? fallback.model;
  const maxOutputTokens = normalizeOptionalPositiveInt(value.maxOutputTokens);
  const timeoutMs = normalizeOptionalPositiveInt(value.timeoutMs);
  const temperatureRaw = value.temperature;
  const temperature =
    typeof temperatureRaw === "number" && Number.isFinite(temperatureRaw) && temperatureRaw >= 0
      ? Math.min(2, temperatureRaw)
      : undefined;

  return {
    speed: normalizeSpeed(value.speed) ?? fallback.speed,
    thinking: normalizeThinking(value.thinking) ?? fallback.thinking,
    budget: normalizeBudget(value.budget) ?? fallback.budget,
    ...(model ? { model } : {}),
    ...(typeof maxOutputTokens === "number" ? { maxOutputTokens } : {}),
    ...(typeof temperature === "number" ? { temperature } : {}),
    ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
  };
}

function normalizeStringArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: readonly T[],
): T[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const allowedSet = new Set(allowed);
  const result: T[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && allowedSet.has(entry as T) && !result.includes(entry as T)) {
      result.push(entry as T);
    }
  }
  return result.length > 0 ? result : [...fallback];
}

export function resolveMemoryDreamingPluginId(
  cfg: Record<string, unknown> | undefined,
): string {
  if (!cfg) {
    return DEFAULT_MEMORY_DREAMING_PLUGIN_ID;
  }
  const plugins = cfg.plugins as Record<string, unknown> | undefined;
  const slots = plugins?.slots as Record<string, unknown> | undefined;
  const configuredSlot = normalizeTrimmedString(slots?.memory);
  if (configuredSlot && configuredSlot.toLowerCase() !== "none") {
    return configuredSlot;
  }
  return DEFAULT_MEMORY_DREAMING_PLUGIN_ID;
}

export function resolveMemoryDreamingPluginConfig(
  cfg: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!cfg) {
    return undefined;
  }
  const plugins = cfg.plugins as Record<string, unknown> | undefined;
  const entries = plugins?.entries as Record<string, unknown> | undefined;
  const pluginId = resolveMemoryDreamingPluginId(cfg);
  const memoryPlugin = entries?.[pluginId] as Record<string, unknown> | undefined;
  return memoryPlugin?.config as Record<string, unknown> | undefined;
}

export function resolveMemoryDreamingConfig(params: {
  pluginConfig?: Record<string, unknown>;
  cfg?: Record<string, unknown>;
}): MemoryDreamingConfig {
  const dreaming = params.pluginConfig?.dreaming as Record<string, unknown> | undefined;
  const frequency = normalizeTrimmedString(dreaming?.frequency) ?? DEFAULT_MEMORY_DREAMING_FREQUENCY;
  const agents = params.cfg?.agents as Record<string, unknown> | undefined;
  const defaults = agents?.defaults as Record<string, unknown> | undefined;
  const timezone =
    normalizeTrimmedString(dreaming?.timezone) ??
    normalizeTrimmedString(defaults?.userTimezone) ??
    DEFAULT_MEMORY_DREAMING_TIMEZONE;

  const storage = dreaming?.storage as Record<string, unknown> | undefined;
  const execution = dreaming?.execution as Record<string, unknown> | undefined;
  const phases = dreaming?.phases as Record<string, unknown> | undefined;
  const topLevelModel = normalizeTrimmedString(dreaming?.model);

  const defaultExecution = resolveExecutionConfig(
    execution?.defaults as Record<string, unknown> | undefined,
    {
      speed: DEFAULT_MEMORY_DREAMING_SPEED,
      thinking: DEFAULT_MEMORY_DREAMING_THINKING,
      budget: DEFAULT_MEMORY_DREAMING_BUDGET,
      ...(topLevelModel ? { model: topLevelModel } : {}),
    },
  );

  const light = phases?.light as Record<string, unknown> | undefined;
  const deep = phases?.deep as Record<string, unknown> | undefined;
  const rem = phases?.rem as Record<string, unknown> | undefined;
  const deepRecovery = deep?.recovery as Record<string, unknown> | undefined;
  const maxAgeDays = normalizeOptionalPositiveInt(deep?.maxAgeDays);

  return {
    enabled: normalizeBoolean(dreaming?.enabled, DEFAULT_MEMORY_DREAMING_ENABLED),
    frequency,
    ...(timezone ? { timezone } : {}),
    verboseLogging: normalizeBoolean(
      dreaming?.verboseLogging,
      DEFAULT_MEMORY_DREAMING_VERBOSE_LOGGING,
    ),
    storage: {
      mode: normalizeStorageMode(storage?.mode),
      separateReports: normalizeBoolean(
        storage?.separateReports,
        DEFAULT_MEMORY_DREAMING_SEPARATE_REPORTS,
      ),
    },
    execution: {
      defaults: defaultExecution,
    },
    phases: {
      light: {
        enabled: normalizeBoolean(light?.enabled, true),
        cron: frequency,
        lookbackDays: normalizeNonNegativeInt(
          light?.lookbackDays,
          DEFAULT_MEMORY_LIGHT_DREAMING_LOOKBACK_DAYS,
        ),
        limit: normalizeNonNegativeInt(
          light?.limit,
          DEFAULT_MEMORY_LIGHT_DREAMING_LIMIT,
        ),
        dedupeSimilarity: typeof light?.dedupeSimilarity === "number"
          ? normalizeScore(light.dedupeSimilarity, DEFAULT_MEMORY_LIGHT_DREAMING_DEDUPE_SIMILARITY)
          : DEFAULT_MEMORY_LIGHT_DREAMING_DEDUPE_SIMILARITY,
        sources: normalizeStringArray(
          light?.sources,
          ["daily", "sessions", "recall"] as const,
          DEFAULT_MEMORY_LIGHT_DREAMING_SOURCES,
        ),
        execution: resolveExecutionConfig(
          light?.execution as Record<string, unknown> | undefined,
          { ...defaultExecution, speed: "fast", thinking: "low", budget: "cheap" },
        ),
      },
      deep: {
        enabled: normalizeBoolean(deep?.enabled, true),
        cron: frequency,
        limit: normalizeNonNegativeInt(deep?.limit, DEFAULT_MEMORY_DEEP_DREAMING_LIMIT),
        minScore: normalizeScore(deep?.minScore, DEFAULT_MEMORY_DEEP_DREAMING_MIN_SCORE),
        minRecallCount: normalizeNonNegativeInt(
          deep?.minRecallCount,
          DEFAULT_MEMORY_DEEP_DREAMING_MIN_RECALL_COUNT,
        ),
        minUniqueQueries: normalizeNonNegativeInt(
          deep?.minUniqueQueries,
          DEFAULT_MEMORY_DEEP_DREAMING_MIN_UNIQUE_QUERIES,
        ),
        recencyHalfLifeDays: normalizeNonNegativeInt(
          deep?.recencyHalfLifeDays,
          DEFAULT_MEMORY_DEEP_DREAMING_RECENCY_HALF_LIFE_DAYS,
        ),
        ...(typeof maxAgeDays === "number"
          ? { maxAgeDays }
          : { maxAgeDays: DEFAULT_MEMORY_DEEP_DREAMING_MAX_AGE_DAYS }),
        sources: normalizeStringArray(
          deep?.sources,
          ["daily", "memory", "sessions", "logs", "recall"] as const,
          DEFAULT_MEMORY_DEEP_DREAMING_SOURCES,
        ),
        recovery: {
          enabled: normalizeBoolean(
            deepRecovery?.enabled,
            DEFAULT_MEMORY_DEEP_DREAMING_RECOVERY_ENABLED,
          ),
          triggerBelowHealth: normalizeScore(
            deepRecovery?.triggerBelowHealth,
            DEFAULT_MEMORY_DEEP_DREAMING_RECOVERY_TRIGGER_BELOW_HEALTH,
          ),
          lookbackDays: normalizeNonNegativeInt(
            deepRecovery?.lookbackDays,
            DEFAULT_MEMORY_DEEP_DREAMING_RECOVERY_LOOKBACK_DAYS,
          ),
          maxRecoveredCandidates: normalizeNonNegativeInt(
            deepRecovery?.maxRecoveredCandidates,
            DEFAULT_MEMORY_DEEP_DREAMING_RECOVERY_MAX_CANDIDATES,
          ),
          minRecoveryConfidence: normalizeScore(
            deepRecovery?.minRecoveryConfidence,
            DEFAULT_MEMORY_DEEP_DREAMING_RECOVERY_MIN_CONFIDENCE,
          ),
          autoWriteMinConfidence: normalizeScore(
            deepRecovery?.autoWriteMinConfidence,
            DEFAULT_MEMORY_DEEP_DREAMING_RECOVERY_AUTO_WRITE_MIN_CONFIDENCE,
          ),
        },
        execution: resolveExecutionConfig(
          deep?.execution as Record<string, unknown> | undefined,
          { ...defaultExecution, speed: "balanced", thinking: "high", budget: "medium" },
        ),
      },
      rem: {
        enabled: normalizeBoolean(rem?.enabled, true),
        cron: frequency,
        lookbackDays: normalizeNonNegativeInt(
          rem?.lookbackDays,
          DEFAULT_MEMORY_REM_DREAMING_LOOKBACK_DAYS,
        ),
        limit: normalizeNonNegativeInt(rem?.limit, DEFAULT_MEMORY_REM_DREAMING_LIMIT),
        minPatternStrength: normalizeScore(
          rem?.minPatternStrength,
          DEFAULT_MEMORY_REM_DREAMING_MIN_PATTERN_STRENGTH,
        ),
        sources: normalizeStringArray(
          rem?.sources,
          ["memory", "daily", "deep"] as const,
          DEFAULT_MEMORY_REM_DREAMING_SOURCES,
        ),
        execution: resolveExecutionConfig(
          rem?.execution as Record<string, unknown> | undefined,
          { ...defaultExecution, speed: "slow", thinking: "high", budget: "expensive" },
        ),
      },
    },
  };
}
