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
  input: Partial<{ title: string }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const title = input?.title;
  if (!title) return null;
  if (verbose) {
    return (
      <Box flexDirection="row">
        <Text dimColor>Listing snapshots for: </Text>
        <Text bold>{title}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="row">
      <Text dimColor>Knowledge snapshots: </Text>
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
  const snapshots = parsed.snapshots || parsed.versions || [];

  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return (
      <Box flexDirection="row">
        <Text dimColor>No snapshots found</Text>
        {title && <Text dimColor> for "{title}"</Text>}
      </Box>
    );
  }

  if (verbose) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text bold>{snapshots.length}</Text>
          <Text> snapshots</Text>
          {title && (
            <Text>
              {' '}
              for <Text italic>{title}</Text>
            </Text>
          )}
        </Box>
        <Box marginTop={1} marginLeft={2} flexDirection="column">
          {snapshots.slice(0, 10).map((s: any, i: number) => (
            <Box key={i} flexDirection="row">
              <Text dimColor>[{i + 1}]</Text>
              <Text> {s.filename || s.name || `snapshot_${i}`}</Text>
              {s.timestamp && <Text dimColor> ({s.timestamp})</Text>}
            </Box>
          ))}
          {snapshots.length > 10 && (
            <Text dimColor>... {snapshots.length - 10} more</Text>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text bold>{snapshots.length}</Text>
        <Text> snapshots</Text>
        {title && (
          <Text>
            {' '}
            for <Text bold>{title}</Text>
          </Text>
        )}
      </Box>
      <Box marginTop={1} marginLeft={2} flexDirection="column">
        {snapshots.slice(0, 5).map((s: any, i: number) => (
          <Text key={i} dimColor>
            {s.filename || s.name || `snapshot_${i}`}
          </Text>
        ))}
        {snapshots.length > 5 && (
          <Text dimColor>... {snapshots.length - 5} more</Text>
        )}
      </Box>
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  if (!verbose) return <Text color="red">Snapshot listing failed</Text>;
  return <Text color="red">Snapshot listing failed: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ title: string }> | undefined
): string | null {
  if (!input?.title) return null;
  return `Knowledge snapshots: ${input.title.slice(0, 60)}`;
}
