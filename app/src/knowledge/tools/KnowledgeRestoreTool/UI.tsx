import React from 'react';
import { Text, Box } from '../../../components/ink.js';

function parseOutput(output: any): any {
  if (typeof output === 'string') {
    try {
      return JSON.parse(output);
    } catch {
      return {};
    }
  }
  return output || {};
}

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
  output: any,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const parsed = parseOutput(output);
  const title = parsed.title || '';
  const snapshot = parsed.snapshot || parsed.version || '';

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
