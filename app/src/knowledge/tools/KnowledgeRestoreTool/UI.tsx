import React from 'react';
import { Text, Box } from '../../../components/ink.js';
import { parseToolOutput } from '../parseToolOutput.js';
import type { KnowledgeRestoreOutput } from '../types.js';

export function renderToolUseMessage(
  input: Partial<{ title: string; snapshot: string }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const title = input?.title;
  const snapshot = input?.snapshot;
  if (!title) return null;
  if (verbose) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text dimColor>Restoring: </Text>
          <Text bold>{title}</Text>
        </Box>
        {snapshot && (
          <Box marginTop={1}>
            <Text dimColor>From snapshot: {snapshot}</Text>
          </Box>
        )}
      </Box>
    );
  }
  return (
    <Box flexDirection="row">
      <Text dimColor>Knowledge restore: </Text>
      <Text bold>{title.slice(0, 60)}</Text>
    </Box>
  );
}

export function renderToolResultMessage(
  output: unknown,
  _progressMessages: unknown[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  // 工具契约：result = { title, snapshot }
  const parsed = parseToolOutput(output) as KnowledgeRestoreOutput;
  const title = parsed.title || '';
  const snapshot = parsed.snapshot || '';

  if (verbose && snapshot) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">Restored: </Text>
          <Text bold>{title}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>From snapshot: {snapshot}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color="green">Restored: </Text>
        <Text bold>{title}</Text>
      </Box>
      {snapshot && (
        <Box marginTop={1}>
          <Text dimColor>Snapshot: {snapshot}</Text>
        </Box>
      )}
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  if (!verbose) return <Text color="red">Knowledge restore failed</Text>;
  return <Text color="red">Knowledge restore failed: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ title: string; snapshot: string }> | undefined
): string | null {
  if (!input?.title) return null;
  return `Knowledge restore: ${input.title.slice(0, 60)}`;
}
