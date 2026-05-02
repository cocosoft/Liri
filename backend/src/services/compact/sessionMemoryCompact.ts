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
