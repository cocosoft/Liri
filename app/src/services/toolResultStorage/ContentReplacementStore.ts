import type {
  ContentReplacementState,
  ContentReplacementRecord,
  ToolResultCandidate,
  CandidatePartition,
  PersistedToolResult,
  PersistToolResultError,
} from './types';
import {
  PREVIEW_SIZE_BYTES,
  PERSISTED_OUTPUT_TAG,
  PERSISTED_OUTPUT_CLOSING_TAG,
  MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
} from './types';

export function createContentReplacementState(): ContentReplacementState {
  return { seenIds: new Set(), replacements: new Map() };
}

export function cloneContentReplacementState(
  source: ContentReplacementState
): ContentReplacementState {
  return {
    seenIds: new Set(source.seenIds),
    replacements: new Map(source.replacements),
  };
}

export function generatePreview(
  content: string,
  maxBytes: number
): { preview: string; hasMore: boolean } {
  if (content.length <= maxBytes) {
    return { preview: content, hasMore: false };
  }

  const truncated = content.slice(0, maxBytes);
  const lastNewline = truncated.lastIndexOf('\n');
  const cutPoint = lastNewline > maxBytes * 0.5 ? lastNewline : maxBytes;

  return { preview: content.slice(0, cutPoint), hasMore: true };
}

export function buildLargeToolResultMessage(
  result: PersistedToolResult
): string {
  let message = `${PERSISTED_OUTPUT_TAG}\n`;
  message += `Output too large (${formatFileSize(result.originalSize)}). Full output saved to: ${result.filepath}\n\n`;
  message += `Preview (first ${formatFileSize(PREVIEW_SIZE_BYTES)}):\n`;
  message += result.preview;
  message += result.hasMore ? '\n...\n' : '\n';
  message += PERSISTED_OUTPUT_CLOSING_TAG;
  return message;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function contentSize(content: string | Array<unknown>): number {
  if (typeof content === 'string') return content.length;
  return JSON.stringify(content).length;
}

export function isToolResultContentEmpty(
  content: string | Array<unknown> | null | undefined
): boolean {
  if (!content) return true;
  if (typeof content === 'string') return content.trim() === '';
  if (!Array.isArray(content)) return false;
  if (content.length === 0) return true;
  return content.every(
    (block) =>
      typeof block === 'object' &&
      block !== null &&
      'type' in block &&
      (block as Record<string, unknown>).type === 'text' &&
      'text' in block &&
      (typeof (block as Record<string, unknown>).text !== 'string' ||
        ((block as Record<string, unknown>).text as string).trim() === '')
  );
}

export function isPersistError(
  result: PersistedToolResult | PersistToolResultError
): result is PersistToolResultError {
  return 'error' in result;
}

export function partitionCandidates(
  candidates: ToolResultCandidate[],
  state: ContentReplacementState,
  records: ContentReplacementRecord[]
): CandidatePartition {
  const recordMap = new Map<string, string>();
  for (const record of records) {
    recordMap.set(record.toolUseId, record.replacement);
  }

  const mustReapply: Array<ToolResultCandidate & { replacement: string }> = [];
  const frozen: ToolResultCandidate[] = [];
  const fresh: ToolResultCandidate[] = [];

  for (const candidate of candidates) {
    const isSeen = state.seenIds.has(candidate.toolUseId);
    const replacement = recordMap.get(candidate.toolUseId);

    if (isSeen && replacement) {
      mustReapply.push({ ...candidate, replacement });
    } else if (isSeen) {
      frozen.push(candidate);
    } else {
      fresh.push(candidate);
    }
  }

  return { mustReapply, frozen, fresh };
}

export function applyContentReplacement(
  content: string,
  replacement: string,
  state: ContentReplacementState,
  toolUseId: string
): string {
  state.replacements.set(toolUseId, replacement);
  state.seenIds.add(toolUseId);
  return replacement;
}

export function provisionContentReplacementState(
  initialRecords?: ContentReplacementRecord[]
): ContentReplacementState | undefined {
  const enabled = process.env.ENABLE_CONTENT_REPLACEMENT !== 'false';
  if (!enabled) return undefined;
  if (initialRecords && initialRecords.length > 0) {
    return reconstructContentReplacementState(initialRecords);
  }
  return createContentReplacementState();
}

export function reconstructContentReplacementState(
  records: ContentReplacementRecord[]
): ContentReplacementState {
  const state = createContentReplacementState();
  for (const record of records) {
    state.seenIds.add(record.toolUseId);
    state.replacements.set(record.toolUseId, record.replacement);
  }
  return state;
}

export function getPerMessageBudgetLimit(): number {
  const envLimit = process.env.MAX_TOOL_RESULTS_PER_MESSAGE_CHARS;
  if (envLimit) {
    const parsed = parseInt(envLimit, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return MAX_TOOL_RESULTS_PER_MESSAGE_CHARS;
}
