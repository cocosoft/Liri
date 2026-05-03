/**
 * 会话记忆压缩（基于CC源码 services/compact/sessionMemoryCompact.ts）
 */
export interface SessionMemoryCompactResult {
  summary: string;
  originalTokens: number;
  summaryTokens: number;
  compressionRatio: number;
  truncated: boolean;
}

export interface SessionMemoryCompactConfig {
  minTokens: number;
  maxTokens: number;
  minTextBlockMessages: number;
}

export interface SessionMemoryCompactionResult {
  success: boolean;
  summary?: string;
  compactedMessages?: number;
  error?: string;
}

const DEFAULT_COMPACT_CONFIG: SessionMemoryCompactConfig = {
  minTokens: 10000,
  maxTokens: 40000,
  minTextBlockMessages: 5,
};

let sessionMemoryCompactConfig: SessionMemoryCompactConfig = { ...DEFAULT_COMPACT_CONFIG };

export function setSessionMemoryCompactConfig(config: Partial<SessionMemoryCompactConfig>): void {
  sessionMemoryCompactConfig = { ...sessionMemoryCompactConfig, ...config };
}

export function getSessionMemoryCompactConfig(): SessionMemoryCompactConfig {
  return { ...sessionMemoryCompactConfig };
}

export function resetSessionMemoryCompactConfig(): void {
  sessionMemoryCompactConfig = { ...DEFAULT_COMPACT_CONFIG };
}

export function shouldUseSessionMemoryCompaction(): boolean {
  const envVal = process.env.ENABLE_SESSION_MEMORY_COMPACT;
  if (envVal === undefined) return false;
  return envVal === 'true';
}

export function trySessionMemoryCompaction(
  sessionId: string,
  messages: { content?: string; type?: string }[],
): SessionMemoryCompactionResult | null {
  const config = getSessionMemoryCompactConfig();
  const estimatedTokens = messages.reduce((sum, msg) => sum + (msg.content?.length ?? 0) / 4, 0);

  if (estimatedTokens < config.minTokens) {
    return null;
  }

  const summary = compactSessionMemory(
    messages.map(m => m.content || ''),
    config.maxTokens,
  );

  return {
    success: true,
    summary: summary.summary,
    compactedMessages: messages.length,
  };
}

export function calculateMessagesToKeepIndex(
  messages: { content?: string; type?: string }[],
  lastSummarizedIndex: number,
): number {
  if (messages.length === 0) return 0;

  const config = getSessionMemoryCompactConfig();
  const startIndex = Math.max(0, lastSummarizedIndex + 1);

  let tokenCount = 0;
  let keepIndex = messages.length;

  for (let i = messages.length - 1; i >= startIndex; i--) {
    tokenCount += (messages[i].content?.length ?? 0) / 4;
    if (tokenCount > config.maxTokens) {
      keepIndex = i + 1;
      break;
    }
  }

  return Math.max(startIndex, keepIndex);
}

export function adjustIndexToPreserveAPIInvariants(
  messages: { type?: string; parentId?: string; id?: string }[],
  index: number,
): number {
  if (index < 0) return index;

  const adjustedIndex = Math.min(index, messages.length);

  for (let i = adjustedIndex; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.parentId) {
      const parentExists = messages.slice(0, adjustedIndex).some(m => m.id === msg.parentId);
      if (parentExists) {
        return i + 1;
      }
    }
  }

  if (adjustedIndex > 0 && messages[adjustedIndex - 1]?.type === 'assistant') {
    for (let i = adjustedIndex; i < messages.length; i++) {
      if (messages[i]?.type !== 'tool' && messages[i]?.type !== 'tool_result') {
        return i;
      }
    }
    return messages.length;
  }

  return adjustedIndex;
}

export function compactSessionMemory(
  messages: string[],
  maxTokens: number = 4000,
): SessionMemoryCompactResult {
  const joined = messages.join('\n');
  const estimatedTokens = joined.length / 4;
  const summaryTokens = maxTokens;
  const compressionRatio = estimatedTokens > 0 ? summaryTokens / estimatedTokens : 1;

  let summary: string;
  if (joined.length <= maxTokens * 4) {
    summary = joined;
    return { summary, originalTokens: estimatedTokens, summaryTokens: estimatedTokens, compressionRatio: 1, truncated: false };
  }

  if (messages.length <= 3) {
    summary = joined.substring(0, maxTokens * 4);
    return { summary, originalTokens: estimatedTokens, summaryTokens: maxTokens, compressionRatio, truncated: true };
  }

  const recentMessages = messages.slice(-Math.min(messages.length, 5));
  const olderSummary = `[Earlier conversation summary: ${messages.length - recentMessages.length} messages compressed]`;
  summary = `${olderSummary}\n\n${recentMessages.join('\n')}`;

  if (summary.length > maxTokens * 4) {
    summary = summary.substring(0, maxTokens * 4);
  }

  return {
    summary,
    originalTokens: estimatedTokens,
    summaryTokens,
    compressionRatio,
    truncated: true,
  };
}
