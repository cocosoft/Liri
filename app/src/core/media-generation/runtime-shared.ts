import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import type {
  MediaGenerationNormalizationMetadataInput,
  MediaNormalizationEntry,
  MediaNormalizationValue,
  ParsedProviderModelRef,
} from './types.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'core:media-generation:runtime-shared', level: LogLevel.INFO });

export type {
  MediaGenerationNormalizationMetadataInput,
  MediaNormalizationEntry,
  MediaNormalizationValue,
} from './types.js';

export function hasMediaNormalizationEntry<
  TValue extends MediaNormalizationValue,
>(
  entry: MediaNormalizationEntry<TValue> | undefined
): entry is MediaNormalizationEntry<TValue> {
  return Boolean(
    entry &&
    (entry.requested !== undefined ||
      entry.applied !== undefined ||
      entry.derivedFrom !== undefined ||
      (entry.supportedValues?.length ?? 0) > 0)
  );
}

export function buildNoCapabilityModelConfiguredMessage(params: {
  capability: string;
  modelCandidates: ParsedProviderModelRef[];
}): string {
  if (params.modelCandidates.length === 0) {
    return `No model configured for ${params.capability}. Set a model in your agent config.`;
  }
  const tried = params.modelCandidates
    .map((ref) => `${ref.provider}/${ref.model}`)
    .join(', ');
  return `No available model supports ${params.capability}. Tried: ${tried}`;
}

export function throwCapabilityGenerationFailure(params: {
  capability: string;
  modelCandidates: ParsedProviderModelRef[];
  cause?: unknown;
}): never {
  const message = buildNoCapabilityModelConfiguredMessage({
    capability: params.capability,
    modelCandidates: params.modelCandidates,
  });
  if (params.cause instanceof Error) {
    throw new AppError(
      `${message}: ${params.cause.message}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      'CAPABILITY_GENERATION_FAILED',
      { capability: params.capability, cause: params.cause.message }
    );
  }
  throw new AppError(
    message,
    ErrorCategory.EXECUTION,
    ErrorSeverity.HIGH,
    'CAPABILITY_GENERATION_FAILED',
    { capability: params.capability }
  );
}

export function resolveCapabilityModelCandidates(params: {
  modelConfig?: { model?: string; fallbacks?: string[] };
  modelOverride?: string;
  parseModelRef: (raw: string | undefined) => ParsedProviderModelRef | null;
}): ParsedProviderModelRef[] {
  const candidates: ParsedProviderModelRef[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined) => {
    const parsed = params.parseModelRef(raw);
    if (!parsed) {
      return;
    }
    const key = `${parsed.provider}/${parsed.model}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push(parsed);
  };

  add(params.modelOverride);
  add(params.modelConfig?.model);
  if (params.modelConfig?.fallbacks) {
    for (const fb of params.modelConfig.fallbacks) {
      add(fb);
    }
  }

  return candidates;
}

/**
 * 参数归一化：从允许值列表中取最接近的有效值
 *
 * 与供应商无关 — 任何 Provider 的 generateVideo/generateImage 均可使用。
 * 如果用户传入的值在 allowed 列表中则直接使用，否则返回 defaultVal。
 */
export function normalizeByCaps<T>(
  value: T | undefined,
  allowed: readonly T[],
  defaultVal: T
): T {
  if (value !== undefined && allowed.includes(value)) return value;
  return defaultVal;
}
