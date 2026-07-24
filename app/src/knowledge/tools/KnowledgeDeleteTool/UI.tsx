import React from 'react';
import { Text, Box } from '../../../components/ink.js';

function parseOutput(output: any): any {
  if (typeof output === 'string') {
    try { return JSON.parse(output); } catch { return {}; }
  }
  return output || {};
}

export function renderToolUseMessage(
  input: Partial<{ title: string; docPath: string }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const label = input?.title || input?.docPath;
  if (!label) return null;
  if (verbose) {
    return (
      <Box flexDirection="row">
        <Text dimColor>Deleting knowledge document: </Text>
        <Text bold>{label}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="row">
      <Text dimColor>Knowledge delete: </Text>
      <Text bold>{label.slice(0, 60)}</Text>
    </Box>
  );
}

export function renderToolResultMessage(
  output: any,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const parsed = parseOutput(output);
  const title = parsed.title || parsed.filePath || parsed.docPath || 'Unknown';
  const candidates = parsed.candidates;

  if (candidates && Array.isArray(candidates) && candidates.length > 1) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="yellow">Multiple matches for </Text>
          <Text bold>{title}</Text>
        </Box>
        <Box marginTop={1} marginLeft={2} flexDirection="column">
          {candidates.map((c: any, i: number) => (
            <Text key={i} dimColor>
              [{i + 1}] {c.title || c.docPath || c.filePath}
              {c.category ? ` (${c.category})` : ''}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Specify the exact docPath to delete.</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text color="red">Deleted: </Text>
      <Text bold>{title}</Text>
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  if (!verbose) return <Text color="red">Knowledge delete failed</Text>;
  return <Text color="red">Knowledge delete failed: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ title: string; docPath: string }> | undefined
): string | null {
  if (!input) return null;
  const label = input.title || input.docPath;
  if (!label) return null;
  return `Knowledge delete: ${label.slice(0, 60)}`;
}
