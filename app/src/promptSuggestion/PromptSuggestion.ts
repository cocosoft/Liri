/**
 * Prompt Suggestion核心服务模块
 */

import {
  SUGGESTION_PROMPT,
  SUGGESTION_PROMPTS,
  type PromptVariant,
  type SuggestionSource,
  type SuggestionHistory,
} from './types';
import { shouldFilterSuggestion } from './SuggestionFilter';
import { getSuggestionSuppressReason } from './PromptSuggestionConfig';

interface Message {
  type: 'user' | 'assistant';
  content: string;
  isApiErrorMessage?: boolean;
  message?: {
    usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      output_tokens?: number;
    };
  };
}

interface CacheSafeParams {
  // 缓存安全参数，用于复用父请求的缓存
}

interface AppState {
  promptSuggestionEnabled: boolean;
  pendingWorkerRequest: boolean | undefined;
  pendingSandboxRequest: boolean | undefined;
  elicitation: { queue: unknown[] };
  toolPermissionContext: { mode: string };
}

interface Analytics {
  logSuggestionSuppressed: (
    reason: string,
    suggestion?: string,
    promptId?: PromptVariant,
    source?: SuggestionSource
  ) => void;
  logSuggestionOutcome: (
    suggestion: string,
    userInput: string,
    emittedAt: number,
    promptId: PromptVariant,
    generationRequestId: string | null
  ) => void;
}

let analytics: Analytics | null = null;

function getAnalytics(): Analytics {
  if (!analytics) {
    analytics = {
      logSuggestionSuppressed: (reason, suggestion, promptId, source) => {
        if (process.env.DEBUG_PROMPT_SUGGESTION === 'true') {
          console.log(`[PromptSuggestion] Suppressed: ${reason}`, {
            suggestion,
            promptId,
            source,
          });
        }
      },
      logSuggestionOutcome: (
        suggestion,
        userInput,
        emittedAt,
        promptId,
        generationRequestId
      ) => {
        if (process.env.DEBUG_PROMPT_SUGGESTION === 'true') {
          console.log(`[PromptSuggestion] Outcome`, {
            suggestion,
            userInput,
            emittedAt,
            promptId,
            generationRequestId,
          });
        }
      },
    };
  }
  return analytics;
}

export function getPromptVariant(): PromptVariant {
  return 'user_intent';
}

const MAX_PARENT_UNCACHED_TOKENS = 10_000;

export function getParentCacheSuppressReason(
  lastAssistantMessage: Message | null
): string | null {
  if (!lastAssistantMessage) {
    return null;
  }

  const usage = lastAssistantMessage?.message?.usage;
  const inputTokens = usage?.input_tokens ?? 0;
  const cacheWriteTokens = usage?.cache_creation_input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;

  return inputTokens + cacheWriteTokens + outputTokens >
    MAX_PARENT_UNCACHED_TOKENS
    ? 'cache_cold'
    : null;
}

function getLastAssistantMessage(messages: Message[]): Message | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === 'assistant') {
      return messages[i];
    }
  }
  return null;
}

function countAssistantTurns(messages: Message[]): number {
  let count = 0;
  for (const msg of messages) {
    if (msg.type === 'assistant') {
      count++;
    }
  }
  return count;
}

interface GenerateSuggestionResult {
  suggestion: string | null;
  generationRequestId: string | null;
}

/**
 * 生成AI预测建议
 * * 在完整 LLM 集成之前使用上下文感知的启发式建议。
 * 当 PY_APP 的 AI 模块配置完成后可改为调用真实 LLM 推理。
 */
export async function generateSuggestion(
  abortController: AbortController,
  promptId: PromptVariant,
  cacheSafeParams: CacheSafeParams
): Promise<GenerateSuggestionResult> {
  if (process.env.MOCK_PROMPT_SUGGESTION === 'true') {
    return {
      suggestion: 'run the tests',
      generationRequestId: 'mock-' + Date.now(),
    };
  }

  if (abortController.signal.aborted) {
    return { suggestion: null, generationRequestId: null };
  }

  const contextSuggestions: Record<string, string[]> = {
    user_intent: [
      'run the tests',
      'commit the changes',
      'push to remote',
      'review the changes',
      'add documentation',
      'refactor this',
      'merge the PR',
      'deploy to staging',
    ],
    stated_intent: [
      'continue',
      'go ahead',
      'yes',
      'show me more',
      'explain further',
    ],
  };

  const candidates =
    contextSuggestions[promptId] || contextSuggestions['user_intent'];
  const idx = Math.floor(Math.random() * candidates.length);

  return {
    suggestion: candidates[idx],
    generationRequestId: `heuristic-${Date.now()}`,
  };
}

interface TryGenerateSuggestionResult {
  suggestion: string;
  promptId: PromptVariant;
  generationRequestId: string | null;
}

/**
 * 尝试生成建议 - 包含完整的抑制检查和过滤流程
 */
export async function tryGenerateSuggestion(
  abortController: AbortController,
  messages: Message[],
  getAppState: () => AppState,
  cacheSafeParams: CacheSafeParams,
  source?: SuggestionSource
): Promise<TryGenerateSuggestionResult | null> {
  if (abortController.signal.aborted) {
    getAnalytics().logSuggestionSuppressed(
      'aborted',
      undefined,
      undefined,
      source
    );
    return null;
  }

  const assistantTurnCount = countAssistantTurns(messages);
  if (assistantTurnCount < 2) {
    getAnalytics().logSuggestionSuppressed(
      'early_conversation',
      undefined,
      undefined,
      source
    );
    return null;
  }

  const lastAssistantMessage = getLastAssistantMessage(messages);
  if (lastAssistantMessage?.isApiErrorMessage) {
    getAnalytics().logSuggestionSuppressed(
      'last_response_error',
      undefined,
      undefined,
      source
    );
    return null;
  }

  const cacheReason = getParentCacheSuppressReason(lastAssistantMessage);
  if (cacheReason) {
    getAnalytics().logSuggestionSuppressed(
      cacheReason,
      undefined,
      undefined,
      source
    );
    return null;
  }

  const appState = getAppState();
  const suppressReason = getSuggestionSuppressReason(appState);
  if (suppressReason) {
    getAnalytics().logSuggestionSuppressed(
      suppressReason,
      undefined,
      undefined,
      source
    );
    return null;
  }

  const promptId = getPromptVariant();
  const { suggestion, generationRequestId } = await generateSuggestion(
    abortController,
    promptId,
    cacheSafeParams
  );

  if (abortController.signal.aborted) {
    getAnalytics().logSuggestionSuppressed(
      'aborted',
      undefined,
      undefined,
      source
    );
    return null;
  }

  if (!suggestion) {
    getAnalytics().logSuggestionSuppressed(
      'empty',
      undefined,
      promptId,
      source
    );
    return null;
  }

  if (shouldFilterSuggestion(suggestion, promptId, source)) {
    return null;
  }

  return { suggestion, promptId, generationRequestId };
}

/**
 * 记录建议接受/忽略的结果
 */
export function logSuggestionOutcome(
  suggestion: string,
  userInput: string,
  emittedAt: number,
  promptId: PromptVariant,
  generationRequestId: string | null
): void {
  const similarity =
    Math.round((userInput.length / (suggestion.length || 1)) * 100) / 100;
  const wasAccepted = userInput === suggestion;
  const timeMs = Math.max(0, Date.now() - emittedAt);

  getAnalytics().logSuggestionOutcome(
    suggestion,
    userInput,
    emittedAt,
    promptId,
    generationRequestId
  );
}

/**
 * 设置分析器
 */
export function setPromptSuggestionAnalytics(
  analyticsInstance: Analytics
): void {
  analytics = analyticsInstance;
}
