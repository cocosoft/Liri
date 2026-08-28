import React from 'react';
import { Text, Box } from '../../../components/ink.js';
import { parseToolOutput } from '../parseToolOutput.js';
import type { KnowledgeWriteOutput } from '../types.js';

export function renderToolUseMessage(
  input: Partial<{ title: string }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const title = input?.title;
  if (!title) return null;
  if (verbose) {
    return (
      <Box flexDirection="row">
        <Text dimColor>Writing knowledge document: </Text>
        <Text bold>{title}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="row">
      <Text dimColor>Knowledge write: </Text>
      <Text bold>{title.slice(0, 60)}</Text>
    </Box>
  );
}

export function renderToolResultMessage(
  output: unknown,
  _progressMessages: unknown[],
  _options: { verbose: boolean }
): React.ReactNode {
  // 工具契约：result = { success, filePath, action: 'created' | 'updated' | 'skipped' }
  const parsed = parseToolOutput(output) as KnowledgeWriteOutput;
  const action = parsed.action || 'updated';
  const title = parsed.filePath
    ? String(parsed.filePath).split(/[\\/]/).pop()!
    : 'Unknown';
  const actionLabel =
    action === 'created'
      ? 'Created'
      : action === 'skipped'
        ? 'Skipped'
        : 'Updated';
  const status = parsed.success !== false ? 'green' : 'red';

  return (
    <Box flexDirection="row">
      <Text color={status}>{actionLabel}: </Text>
      <Text bold>{title}</Text>
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  if (!verbose) return <Text color="red">Knowledge write failed</Text>;
  return <Text color="red">Knowledge write failed: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ title: string }> | undefined
): string | null {
  if (!input?.title) return null;
  return `Knowledge write: ${input.title.slice(0, 60)}`;
}
