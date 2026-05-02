import type {
  ContentReplacementState,
  ContentReplacementRecord,
} from '../../services/toolResultStorage/types'
import {
  createContentReplacementState,
  applyContentReplacement,
  contentSize,
} from '../../services/toolResultStorage/ContentReplacementStore'
import { applyToolResultBudget } from '../../services/toolResultStorage/ToolResultBudget'

export interface ToolExecutionWithStorage {
  beforeToolCall(toolName: string, args: Record<string, unknown>): void
  afterToolResult(toolUseId: string, content: string | Array<unknown>, toolName?: string): Promise<{
    displayContent: string
    wasStored: boolean
    replacementRecord?: ContentReplacementRecord
  }>
  getReplacementState(): ContentReplacementState
  restoreReplacementState(state: ContentReplacementState): void
  getReplacementRecords(): ContentReplacementRecord[]
}

export function createToolResultStorageHook(): ToolExecutionWithStorage {
  let state = createContentReplacementState()
  const records: ContentReplacementRecord[] = []

  return {
    beforeToolCall(_toolName: string, _args: Record<string, unknown>): void {
    },

    async afterToolResult(
      toolUseId: string,
      content: string | Array<unknown>,
      toolName?: string,
    ): Promise<{
      displayContent: string
      wasStored: boolean
      replacementRecord?: ContentReplacementRecord
    }> {
      const { resultContent, replacementRecord, wasPersisted } =
        await applyToolResultBudget(
          typeof content === 'string' ? content : (content as Array<{ type: string; text?: string }>),
          toolUseId,
          state,
          { toolName },
        )

      if (replacementRecord) {
        records.push(replacementRecord)
      }

      return {
        displayContent: resultContent,
        wasStored: wasPersisted,
        replacementRecord,
      }
    },

    getReplacementState(): ContentReplacementState {
      return state
    },

    restoreReplacementState(newState: ContentReplacementState): void {
      state = newState
    },

    getReplacementRecords(): ContentReplacementRecord[] {
      return [...records]
    },
  }
}

export interface SessionRestoreResult {
  restoredState: ContentReplacementState
  records: ContentReplacementRecord[]
}

export function createSessionRestoreHook(): {
  saveState(state: ContentReplacementState, records: ContentReplacementRecord[]): Record<string, unknown>
  restoreState(data: Record<string, unknown>): SessionRestoreResult | null
} {
  return {
    saveState(state: ContentReplacementState, records: ContentReplacementRecord[]): Record<string, unknown> {
      return {
        version: 1,
        seenIds: Array.from(state.seenIds),
        replacements: Array.from(state.replacements.entries()),
        records,
      }
    },

    restoreState(data: Record<string, unknown>): SessionRestoreResult | null {
      if (!data || typeof data !== 'object' || (data as Record<string, unknown>).version !== 1) {
        return null
      }

      const d = data as {
        version: number
        seenIds: string[]
        replacements: Array<[string, string]>
        records: ContentReplacementRecord[]
      }

      if (!Array.isArray(d.seenIds) || !Array.isArray(d.replacements)) {
        return null
      }

      return {
        restoredState: {
          seenIds: new Set(d.seenIds),
          replacements: new Map(d.replacements),
        },
        records: d.records || [],
      }
    },
  }
}
