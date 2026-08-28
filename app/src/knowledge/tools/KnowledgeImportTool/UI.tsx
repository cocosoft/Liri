import React from 'react';
import { Text, Box } from '../../../components/ink.js';
import { parseToolOutput } from '../parseToolOutput.js';
import type { KnowledgeImportOutput } from '../types.js';

export function renderToolUseMessage(
  input: Partial<{ source: string }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const source = input?.source;
  if (!source) return null;
  if (verbose) {
    return (
      <Box flexDirection="row">
        <Text dimColor>Importing knowledge from: </Text>
        <Text bold>{source}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="row">
      <Text dimColor>Knowledge import: </Text>
      <Text bold>{source.slice(0, 60)}</Text>
    </Box>
  );
}

export function renderToolResultMessage(
  output: unknown,
  _progressMessages: unknown[],
  _options: { verbose: boolean }
): React.ReactNode {
  // 工具契约：result = { imported, skipped, total }
  const parsed = parseToolOutput(output) as KnowledgeImportOutput;
  const imported = parsed.imported ?? 0;
  const skipped = parsed.skipped ?? 0;

  return (
    <Box flexDirection="row">
      <Text color="green">Imported: </Text>
      <Text bold>{imported}</Text>
      <Text> documents</Text>
      {parsed.total != null && <Text dimColor> (of {parsed.total})</Text>}
      {skipped > 0 && <Text dimColor> ({skipped} skipped)</Text>}
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  if (!verbose) return <Text color="red">Knowledge import failed</Text>;
  return <Text color="red">Knowledge import failed: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ source: string }> | undefined
): string | null {
  if (!input?.source) return null;
  return `Knowledge import: ${input.source.slice(0, 60)}`;
}
