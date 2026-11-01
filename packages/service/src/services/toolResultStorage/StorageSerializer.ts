import type {
  ContentReplacementState,
  ContentReplacementRecord,
} from './types';
import { createContentReplacementState } from './ContentReplacementStore';

export function serializeReplacementState(state: ContentReplacementState): {
  seenIds: string[];
  replacements: Array<[string, string]>;
} {
  return {
    seenIds: Array.from(state.seenIds),
    replacements: Array.from(state.replacements.entries()),
  };
}

export function deserializeReplacementState(data: {
  seenIds: string[];
  replacements: Array<[string, string]>;
}): ContentReplacementState {
  return {
    seenIds: new Set(data.seenIds),
    replacements: new Map(data.replacements),
  };
}

export function serializeReplacementRecord(
  record: ContentReplacementRecord
): Record<string, unknown> {
  return {
    kind: record.kind,
    toolUseId: record.toolUseId,
    replacement: record.replacement,
  };
}

export function deserializeReplacementRecord(
  data: Record<string, unknown>
): ContentReplacementRecord | null {
  if (
    data.kind !== 'tool-result' ||
    typeof data.toolUseId !== 'string' ||
    typeof data.replacement !== 'string'
  ) {
    return null;
  }
  return {
    kind: 'tool-result',
    toolUseId: data.toolUseId,
    replacement: data.replacement,
  };
}
