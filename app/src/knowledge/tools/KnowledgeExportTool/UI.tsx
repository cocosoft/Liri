import React from 'react';
import { Text, Box } from '../../../components/ink.js';

function parseOutput(output: any): any {
  if (typeof output === 'string') {
    try { return JSON.parse(output); } catch { return {}; }
  }
  return output || {};
}

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
  output: any,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const parsed = parseOutput(output);
  const count = parsed.count ?? parsed.exported ?? 0;
  const outputPath = parsed.outputPath || parsed.path || '';

  if (verbose && outputPath) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">Exported: </Text>
          <Text bold>{count}</Text>
          <Text> documents</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Output: {outputPath}</Text>
        </Box>
      </Box>
    );
  }

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
