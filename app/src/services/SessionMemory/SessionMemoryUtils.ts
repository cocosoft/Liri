/**
 * Session Memory 工具函数
 *
 * 管理会话记忆的配置、阈值跟踪、提取状态等。
 * 与 SessionMemoryService.ts 分离以避免循环依赖。
 */

const EXTRACTION_WAIT_TIMEOUT_MS = 15000;
const EXTRACTION_STALE_THRESHOLD_MS = 60000;

export interface SessionMemoryConfig {
  minimumMessageTokensToInit: number;
  minimumTokensBetweenUpdate: number;
  toolCallsBetweenUpdates: number;
}

export const DEFAULT_SESSION_MEMORY_CONFIG: SessionMemoryConfig = {
  minimumMessageTokensToInit: 10000,
  minimumTokensBetweenUpdate: 5000,
  toolCallsBetweenUpdates: 3,
};

let sessionMemoryConfig: SessionMemoryConfig = {
  ...DEFAULT_SESSION_MEMORY_CONFIG,
};

let lastSummarizedMessageId: string | undefined;
let extractionStartedAt: number | undefined;
let tokensAtLastExtraction = 0;
let sessionMemoryInitialized = false;
let toolCallCountSinceLastUpdate = 0;

export function getSessionMemoryConfig(): SessionMemoryConfig {
  return { ...sessionMemoryConfig };
}

export function setSessionMemoryConfig(
  config: Partial<SessionMemoryConfig>
): void {
  sessionMemoryConfig = { ...sessionMemoryConfig, ...config };
}

export function getLastSummarizedMessageId(): string | undefined {
  return lastSummarizedMessageId;
}

export function setLastSummarizedMessageId(messageId: string): void {
  lastSummarizedMessageId = messageId;
}

export function markExtractionStarted(): void {
  extractionStartedAt = Date.now();
}

export function markExtractionCompleted(tokensUsed: number): void {
  extractionStartedAt = undefined;
  tokensAtLastExtraction = tokensUsed;
  toolCallCountSinceLastUpdate = 0;
}

export function recordExtractionTokenCount(tokens: number): void {
  tokensAtLastExtraction += tokens;
}

export function isExtractionInProgress(): boolean {
  if (!extractionStartedAt) return false;
  if (Date.now() - extractionStartedAt > EXTRACTION_STALE_THRESHOLD_MS) {
    extractionStartedAt = undefined;
    return false;
  }
  return true;
}

export function isSessionMemoryInitialized(): boolean {
  return sessionMemoryInitialized;
}

export function markSessionMemoryInitialized(): void {
  sessionMemoryInitialized = true;
}

export function hasMetInitializationThreshold(
  currentContextTokens: number
): boolean {
  if (sessionMemoryInitialized) return false;
  return currentContextTokens >= sessionMemoryConfig.minimumMessageTokensToInit;
}

export function hasMetUpdateThreshold(currentContextTokens: number): boolean {
  if (!sessionMemoryInitialized) return false;
  const growthSinceLast = currentContextTokens - tokensAtLastExtraction;
  return growthSinceLast >= sessionMemoryConfig.minimumTokensBetweenUpdate;
}

export function getToolCallsBetweenUpdates(): number {
  return toolCallCountSinceLastUpdate;
}

export function incrementToolCallCount(): void {
  toolCallCountSinceLastUpdate++;
}

export function hasMetToolCallThreshold(): boolean {
  return (
    toolCallCountSinceLastUpdate >= sessionMemoryConfig.toolCallsBetweenUpdates
  );
}

export function resetSessionMemoryState(): void {
  lastSummarizedMessageId = undefined;
  extractionStartedAt = undefined;
  tokensAtLastExtraction = 0;
  sessionMemoryInitialized = false;
  toolCallCountSinceLastUpdate = 0;
}
