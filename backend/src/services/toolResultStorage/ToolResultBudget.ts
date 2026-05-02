import type {
  ContentReplacementState,
  ContentReplacementRecord,
  ToolResultCandidate,
  CandidatePartition,
  PersistedToolResult,
  PersistToolResultError,
} from './types';
import {
  MAX_TOOL_RESULT_BYTES,
  PREVIEW_SIZE_BYTES,
  BYTES_PER_TOKEN,
} from './types';
import {
  contentSize,
  generatePreview,
  buildLargeToolResultMessage,
  isPersistError,
  partitionCandidates,
  applyContentReplacement,
  getPerMessageBudgetLimit,
  formatFileSize,
} from './ContentReplacementStore';

export interface ToolResultBudgetOptions {
  persistenceThreshold?: number
  toolName?: string
}

export async function applyToolResultBudget(
  content: string | Array<{ type: string; text?: string }>,
  toolUseId: string,
  state: ContentReplacementState,
  options: ToolResultBudgetOptions = {},
): Promise<{
  resultContent: string
  replacementRecord?: ContentReplacementRecord
  wasPersisted: boolean
}> {
  const threshold = options.persistenceThreshold ?? MAX_TOOL_RESULT_BYTES
  const size = contentSize(content)

  if (size <= threshold) {
    state.seenIds.add(toolUseId)
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content)
    return { resultContent: contentStr, wasPersisted: false }
  }

  const contentStr = typeof content === 'string' ? content : JSON.stringify(content)
  const { preview, hasMore } = generatePreview(contentStr, PREVIEW_SIZE_BYTES)

  const persistedResult: PersistedToolResult = {
    filepath: `tool-results/${toolUseId}.txt`,
    originalSize: size,
    isJson: typeof content !== 'string',
    preview,
    hasMore,
  }

  const message = buildLargeToolResultMessage(persistedResult)
  state.seenIds.add(toolUseId)
  state.replacements.set(toolUseId, message)

  const record: ContentReplacementRecord = {
    kind: 'tool-result',
    toolUseId,
    replacement: message,
  }

  return {
    resultContent: message,
    replacementRecord: record,
    wasPersisted: true,
  }
}

export function enforceToolResultBudget(
  candidates: ToolResultCandidate[],
  state: ContentReplacementState,
  existingRecords: ContentReplacementRecord[],
): {
  processedResults: Array<{
    toolUseId: string
    content: string
    wasReplaced: boolean
  }>
  newRecords: ContentReplacementRecord[]
} {
  const budget = getPerMessageBudgetLimit()
  const { mustReapply, frozen, fresh } = partitionCandidates(
    candidates,
    state,
    existingRecords,
  )

  const processedResults: Array<{
    toolUseId: string
    content: string
    wasReplaced: boolean
  }> = []
  const newRecords: ContentReplacementRecord[] = []

  let currentBudgetUsed = 0

  for (const candidate of mustReapply) {
    const contentStr = typeof candidate.content === 'string'
      ? candidate.content
      : JSON.stringify(candidate.content)
    currentBudgetUsed += candidate.replacement.length
    processedResults.push({
      toolUseId: candidate.toolUseId,
      content: candidate.replacement,
      wasReplaced: true,
    })
  }

  for (const candidate of frozen) {
    const contentStr = typeof candidate.content === 'string'
      ? candidate.content
      : JSON.stringify(candidate.content)
    currentBudgetUsed += contentStr.length
    processedResults.push({
      toolUseId: candidate.toolUseId,
      content: contentStr,
      wasReplaced: false,
    })
  }

  for (const candidate of fresh) {
    const contentStr = typeof candidate.content === 'string'
      ? candidate.content
      : JSON.stringify(candidate.content)

    if (currentBudgetUsed + contentStr.length > budget) {
      const replacement = `[Tool result from ${candidate.toolUseId} exceeds budget. ${formatFileSize(contentStr.length)} output truncated.]`
      state.replacements.set(candidate.toolUseId, replacement)
      state.seenIds.add(candidate.toolUseId)

      const record: ContentReplacementRecord = {
        kind: 'tool-result',
        toolUseId: candidate.toolUseId,
        replacement,
      }
      newRecords.push(record)

      processedResults.push({
        toolUseId: candidate.toolUseId,
        content: replacement,
        wasReplaced: true,
      })
      currentBudgetUsed += replacement.length
    } else {
      state.seenIds.add(candidate.toolUseId)
      processedResults.push({
        toolUseId: candidate.toolUseId,
        content: contentStr,
        wasReplaced: false,
      })
      currentBudgetUsed += contentStr.length
    }
  }

  return { processedResults, newRecords }
}

export function estimateTokenSavings(
  originalSize: number,
  replacementSize: number,
): number {
  const originalTokens = Math.ceil(originalSize / BYTES_PER_TOKEN)
  const replacementTokens = Math.ceil(replacementSize / BYTES_PER_TOKEN)
  return originalTokens - replacementTokens
}
