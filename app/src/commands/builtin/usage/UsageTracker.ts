/**
 * /usage 命令 - 用量统计
 */

export interface UsageStats {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  totalCostUSD: number;
  apiCalls: number;
  toolCalls: number;
  sessionDurationMs: number;
}

let sessionUsage: UsageStats = {
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreateTokens: 0,
  totalCostUSD: 0,
  apiCalls: 0,
  toolCalls: 0,
  sessionDurationMs: 0,
};

const sessionStartTime = Date.now();

export function recordUsage(usage: Partial<UsageStats>): void {
  if (usage.inputTokens) sessionUsage.inputTokens += usage.inputTokens;
  if (usage.outputTokens) sessionUsage.outputTokens += usage.outputTokens;
  if (usage.cacheReadTokens)
    sessionUsage.cacheReadTokens += usage.cacheReadTokens;
  if (usage.cacheCreateTokens)
    sessionUsage.cacheCreateTokens += usage.cacheCreateTokens;
  if (usage.totalCostUSD) sessionUsage.totalCostUSD += usage.totalCostUSD;
  if (usage.apiCalls) sessionUsage.apiCalls += usage.apiCalls;
  if (usage.toolCalls) sessionUsage.toolCalls += usage.toolCalls;

  sessionUsage.totalTokens =
    sessionUsage.inputTokens + sessionUsage.outputTokens;
  sessionUsage.sessionDurationMs = Date.now() - sessionStartTime;
}

export function getUsageStats(): UsageStats {
  return {
    ...sessionUsage,
    sessionDurationMs: Date.now() - sessionStartTime,
  };
}

export function resetUsageStats(): void {
  sessionUsage = {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    totalCostUSD: 0,
    apiCalls: 0,
    toolCalls: 0,
    sessionDurationMs: 0,
  };
}

export function formatUsageReport(stats: UsageStats): string {
  const kb = (n: number) => (n / 1000).toFixed(1);
  return [
    `Session Duration: ${Math.round(stats.sessionDurationMs / 1000)}s`,
    `API Calls:        ${stats.apiCalls}`,
    `Tool Calls:       ${stats.toolCalls}`,
    `Input Tokens:     ${kb(stats.inputTokens)}k`,
    `Output Tokens:    ${kb(stats.outputTokens)}k`,
    `Cache Read:       ${kb(stats.cacheReadTokens)}k`,
    `Cache Created:    ${kb(stats.cacheCreateTokens)}k`,
    `Total Cost:       $${stats.totalCostUSD.toFixed(4)}`,
  ].join('\n');
}
