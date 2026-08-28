import React from 'react';
import { Text, Box } from '../../../components/ink.js';
import { parseToolOutput } from '../parseToolOutput.js';
import type { KnowledgeExportOutput } from '../types.js';

export function renderToolUseMessage(
  input: Partial<{ format: string }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const fmt = input?.format || 'markdown';
  if (verbose) {
    return (
      <Box flexDirection="row">
        <Text dimColor>Exporting knowledge base as </Text>
        <Text bold>{fmt}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="row">
      <Text dimColor>Knowledge export: </Text>
      <Text bold>{fmt}</Text>
    </Box>
  );
}

export function renderToolResultMessage(
  output: unknown,
  _progressMessages: unknown[],
  _options: { verbose: boolean }
): React.ReactNode {
  // 工具契约：result = { exported, targetDir, format }
  const parsed = parseToolOutput(output) as KnowledgeExportOutput;
  const count = parsed.exported ?? 0;
  const outputPath = parsed.targetDir || '';

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color="green">Exported: </Text>
        <Text bold>{count}</Text>
        <Text> documents</Text>
      </Box>
      {outputPath && (
        <Box marginTop={1}>
          <Text dimColor>Output: {outputPath}</Text>
        </Box>
      )}
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  if (!verbose) return <Text color="red">Knowledge export failed</Text>;
  return <Text color="red">Knowledge export failed: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ format: string }> | undefined
): string | null {
  return `Knowledge export: ${input?.format || 'markdown'}`;
}
