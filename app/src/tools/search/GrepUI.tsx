// import React from 'react'
import { Box, Text } from '@modules/ink';

export type GrepOutput = {
  pattern?: string;
  path?: string;
  matches?: Array<{ file: string; line: number; content: string }>;
  matchCount?: number;
  fileCount?: number;
  output_mode?: string;
};

export function renderToolUseMessage(
  input: Partial<{ pattern: string; path: string }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { pattern, path } = input;
  if (!pattern) return null;

  if (verbose) {
    return (
      <Box flexDirection="row">
        <Text dimColor>Searching for </Text>
        <Text bold>{pattern}</Text>
        {path ? <Text dimColor> in {path}</Text> : null}
      </Box>
    );
  }

  return (
    <Text>
      <Text dimColor>Searching for </Text>
      <Text bold>{pattern.slice(0, 60)}</Text>
    </Text>
  );
}

export function renderToolResultMessage(
  output: GrepOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { matchCount, fileCount, output_mode } = output;

  if (output_mode === 'count') {
    return (
      <Text>
        Found <Text bold>{matchCount ?? 0}</Text> matches
        {fileCount !== undefined ? (
          <Text dimColor>
            {' '}
            in {fileCount} file{fileCount !== 1 ? 's' : ''}
          </Text>
        ) : null}
      </Text>
    );
  }

  if (output_mode === 'files_with_matches') {
    return (
      <Text>
        Found matches in <Text bold>{fileCount ?? 0}</Text> file
        {fileCount !== 1 ? 's' : ''}
      </Text>
    );
  }

  if (verbose && output.matches && output.matches.length > 0) {
    return (
      <Box flexDirection="column">
        <Text>
          Found <Text bold>{matchCount ?? output.matches.length}</Text> matches
          {fileCount !== undefined ? (
            <Text dimColor>
              {' '}
              in {fileCount} file{fileCount !== 1 ? 's' : ''}
            </Text>
          ) : null}
        </Text>
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>
            {output.matches
              .slice(0, 15)
              .map((m) => `${m.file}:${m.line}: ${m.content.slice(0, 100)}`)
              .join('\n')}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Text>
      Found <Text bold>{matchCount ?? 0}</Text> matches
    </Text>
  );
}

export function getToolUseSummary(
  input: Partial<{ pattern: string; path: string }> | undefined
): string | null {
  if (!input?.pattern) return null;
  const base = `grep "${input.pattern.slice(0, 40)}"`;
  return input.path ? `${base} ${input.path}` : base;
}
