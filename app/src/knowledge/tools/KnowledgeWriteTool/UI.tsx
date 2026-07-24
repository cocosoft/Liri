import React from 'react';
import { Text, Box } from '../../../components/ink.js';

function parseOutput(output: any): any {
  if (typeof output === 'string') {
    try { return JSON.parse(output); } catch { return {}; }
  }
  return output || {};
}

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
  output: any,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const parsed = parseOutput(output);
  const title = parsed.title || parsed.filePath || 'Unknown';
  const isNew = parsed.isNew ?? parsed.created;
  const status = parsed.success !== false ? 'green' : 'red';

  if (verbose && parsed.content) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color={status}>{isNew ? 'Created' : 'Updated'}: </Text>
          <Text bold>{title}</Text>
        </Box>
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>{String(parsed.content).slice(0, 200)}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text color={status}>{isNew ? 'Created' : 'Updated'}: </Text>
      <Text bold>{title}</Text>
      {parsed.wordCount && <Text dimColor> ({parsed.wordCount} words)</Text>}
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
