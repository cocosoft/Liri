import type { ChatOptions } from './AIProvider';
import type { ChatMessage, ChatResponse } from '../models/types';

export interface FallbackConfig {
  enabled: boolean;
  models: string[];
  retryLimit: number;
  retryDelayMs: number;
}

const DEFAULT_FALLBACK_CONFIG: FallbackConfig = {
  enabled: true,
  models: [],
  retryLimit: 2,
  retryDelayMs: 1000,
};

export function createFallbackProvider(
  primaryCall: (
    model: string,
    messages: ChatMessage[],
    options?: ChatOptions
  ) => Promise<ChatResponse>,
  config: Partial<FallbackConfig> = {}
): (
  model: string,
  messages: ChatMessage[],
  options?: ChatOptions
) => Promise<ChatResponse> {
  const cfg = { ...DEFAULT_FALLBACK_CONFIG, ...config };

  return async (
    model: string,
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse> => {
    if (!cfg.enabled || cfg.models.length === 0) {
      return primaryCall(model, messages, options);
    }

    const modelQueue = [model, ...cfg.models.filter((m) => m !== model)];

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < modelQueue.length; attempt++) {
      const currentModel = modelQueue[attempt];

      for (let retry = 0; retry <= cfg.retryLimit; retry++) {
        try {
          const result = await primaryCall(currentModel, messages, options);
          return result;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (isRetryableError(lastError) && retry < cfg.retryLimit) {
            await delay(cfg.retryDelayMs * (retry + 1));
            continue;
          }
          break;
        }
      }
    }

    throw lastError || new Error('All models exhausted');
  };
}

function isRetryableError(err: Error): boolean {
  const msg = err.message.toLowerCase();

  if (msg.includes('529') || msg.includes('overloaded')) return true;
  if (msg.includes('429') || msg.includes('rate limit')) return true;
  if (msg.includes('503') || msg.includes('service unavailable')) return true;
  if (msg.includes('timeout') || msg.includes('timed out')) return true;

  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
