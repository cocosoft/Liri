import React from 'react';
import { Text, Box } from '../../../components/ink.js';

function parseOutput(output: any): any {
  if (typeof output === 'string') {
    try { return JSON.parse(output); } catch { return {}; }
  }
  return output || {};
}

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
  output: any,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const parsed = parseOutput(output);
  const imported = parsed.imported ?? parsed.count ?? 0;
  const skipped = parsed.skipped ?? 0;
  const errors = parsed.errors ?? 0;

  if (verbose && parsed.files && Array.isArray(parsed.files)) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">Imported: </Text>
          <Text bold>{imported}</Text>
          <Text> documents</Text>
          {skipped > 0 && <Text dimColor> ({skipped} skipped)</Text>}
          {errors > 0 && <Text color="red"> ({errors} errors)</Text>}
        </Box>
        <Box marginTop={1} marginLeft={2} flexDirection="column">
          {parsed.files.slice(0, 10).map((f: string, i: number) => (
            <Text key={i} dimColor>{f}</Text>
          ))}
          {parsed.files.length > 10 && (
            <Text dimColor>... {parsed.files.length - 10} more files</Text>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text color="green">Imported: </Text>
      <Text bold>{imported}</Text>
      <Text> documents</Text>
      {skipped > 0 && <Text dimColor> ({skipped} skipped)</Text>}
      {errors > 0 && <Text color="red"> ({errors} errors)</Text>}
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
