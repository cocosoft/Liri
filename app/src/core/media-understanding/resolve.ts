import type {
  MediaUnderstandingCapability,
  MediaUnderstandingProvider,
} from './types.js';

const DEFAULT_MAX_CHARS_BY_CAPABILITY: Record<
  MediaUnderstandingCapability,
  number | undefined
> = {
  image: 800,
  audio: undefined,
  video: 1200,
};

const DEFAULT_MAX_BYTES: Record<MediaUnderstandingCapability, number> = {
  image: 20_000_000,
  audio: 25_000_000,
  video: 50_000_000,
};

const DEFAULT_PROMPT: Record<MediaUnderstandingCapability, string> = {
  image: 'Describe this image in detail.',
  audio: 'Transcribe the audio accurately.',
  video: 'Describe this video in detail.',
};

const DEFAULT_MEDIA_CONCURRENCY = 5;

export function resolveTimeoutMs(
  seconds: number | undefined,
  fallbackSeconds: number
): number {
  const value =
    typeof seconds === 'number' && Number.isFinite(seconds)
      ? seconds
      : fallbackSeconds;
  return Math.max(1000, Math.floor(value * 1000));
}

export function resolvePrompt(
  capability: MediaUnderstandingCapability,
  prompt?: string,
  maxChars?: number
): string {
  const base = prompt?.trim() || DEFAULT_PROMPT[capability];
  if (!maxChars || capability === 'audio') {
    return base;
  }
  return `${base} Respond in at most ${maxChars} characters.`;
}

export function resolveMaxChars(params: {
  capability: MediaUnderstandingCapability;
  entry?: { maxChars?: number };
  config?: { maxChars?: number };
  cfg?: {
    tools?: {
      media?: Partial<
        Record<MediaUnderstandingCapability, { maxChars?: number }>
      >;
    };
  };
}): number | undefined {
  const configured =
    params.entry?.maxChars ??
    params.config?.maxChars ??
    params.cfg?.tools?.media?.[params.capability]?.maxChars;
  if (typeof configured === 'number') {
    return configured;
  }
  return DEFAULT_MAX_CHARS_BY_CAPABILITY[params.capability];
}

export function resolveMaxBytes(params: {
  capability: MediaUnderstandingCapability;
  entry?: { maxBytes?: number };
  config?: { maxBytes?: number };
  cfg?: {
    tools?: {
      media?: Partial<
        Record<MediaUnderstandingCapability, { maxBytes?: number }>
      >;
    };
  };
}): number {
  const configured =
    params.entry?.maxBytes ??
    params.config?.maxBytes ??
    params.cfg?.tools?.media?.[params.capability]?.maxBytes;
  if (typeof configured === 'number') {
    return configured;
  }
  return DEFAULT_MAX_BYTES[params.capability];
}

export function resolveScopeDecision(params: {
  scope?: { allow?: string[]; deny?: string[] };
  sessionKey?: string;
  channel?: string;
}): 'allow' | 'deny' {
  if (!params.scope) {
    return 'allow';
  }
  if (params.scope.deny && params.scope.deny.length > 0) {
    const key = params.sessionKey ?? params.channel ?? '';
    for (const pattern of params.scope.deny) {
      if (key.includes(pattern)) {
        return 'deny';
      }
    }
  }
  if (params.scope.allow && params.scope.allow.length > 0) {
    const key = params.sessionKey ?? params.channel ?? '';
    for (const pattern of params.scope.allow) {
      if (key.includes(pattern)) {
        return 'allow';
      }
    }
    return 'deny';
  }
  return 'allow';
}

type ModelEntry = {
  provider?: string;
  command?: string;
  model?: string;
  capabilities?: string[];
};

export function resolveModelEntries(params: {
  capability: MediaUnderstandingCapability;
  config?: { models?: ModelEntry[] };
  cfg?: { tools?: { media?: { models?: ModelEntry[] } } };
  providerRegistry: Map<string, MediaUnderstandingProvider>;
}): ModelEntry[] {
  const configModels = params.config?.models ?? [];
  const sharedModels = params.cfg?.tools?.media?.models ?? [];
  const entries: ModelEntry[] = [...configModels, ...sharedModels];

  return entries.filter((entry) => {
    if (entry.capabilities) {
      return entry.capabilities.includes(params.capability);
    }
    if (entry.provider) {
      const provider = params.providerRegistry.get(entry.provider);
      if (provider?.capabilities) {
        return provider.capabilities.includes(params.capability);
      }
    }
    return true;
  });
}

export function resolveConcurrency(cfg?: {
  tools?: { media?: { concurrency?: number } };
}): number {
  const configured = cfg?.tools?.media?.concurrency;
  if (
    typeof configured === 'number' &&
    Number.isFinite(configured) &&
    configured > 0
  ) {
    return Math.floor(configured);
  }
  return DEFAULT_MEDIA_CONCURRENCY;
}

export function resolveEntriesWithActiveFallback(params: {
  capability: MediaUnderstandingCapability;
  config?: { enabled?: boolean; models?: ModelEntry[] };
  cfg?: { tools?: { media?: { models?: ModelEntry[] } } };
  providerRegistry: Map<string, MediaUnderstandingProvider>;
  activeModel?: { provider: string; model?: string };
}): ModelEntry[] {
  const entries = resolveModelEntries({
    capability: params.capability,
    config: params.config,
    cfg: params.cfg,
    providerRegistry: params.providerRegistry,
  });
  if (entries.length > 0) {
    return entries;
  }
  if (params.config?.enabled !== true) {
    return entries;
  }
  const activeProvider = params.activeModel?.provider?.trim();
  if (!activeProvider) {
    return entries;
  }
  const provider = params.providerRegistry.get(activeProvider);
  if (!provider?.capabilities?.includes(params.capability)) {
    return entries;
  }
  return [{ provider: activeProvider, model: params.activeModel?.model }];
}
