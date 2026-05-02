export const BYTES_PER_TOKEN = 4

export const DEFAULT_MAX_RESULT_SIZE_CHARS = 50000

export const MAX_TOOL_RESULT_BYTES = 1_000_000

export const MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 250_000

export const TOOL_RESULTS_SUBDIR = 'tool-results'

export const PERSISTED_OUTPUT_TAG = '<persisted-output>'

export const PERSISTED_OUTPUT_CLOSING_TAG = '</persisted-output>'

export const TOOL_RESULT_CLEARED_MESSAGE = '[Old tool result content cleared]'

export const PREVIEW_SIZE_BYTES = 2000

export type ContentReplacementState = {
  seenIds: Set<string>
  replacements: Map<string, string>
}

export type PersistedToolResult = {
  filepath: string
  originalSize: number
  isJson: boolean
  preview: string
  hasMore: boolean
}

export type PersistToolResultError = {
  error: string
}

export type ContentReplacementRecord = {
  kind: 'tool-result'
  toolUseId: string
  replacement: string
}

export type ToolResultReplacementRecord = Extract<
  ContentReplacementRecord,
  { kind: 'tool-result' }
>

export type ToolResultCandidate = {
  toolUseId: string
  content: string | Array<{ type: string; text?: string }>
  size: number
}

export type CandidatePartition = {
  mustReapply: Array<ToolResultCandidate & { replacement: string }>
  frozen: ToolResultCandidate[]
  fresh: ToolResultCandidate[]
}
