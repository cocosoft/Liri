/**
 * Grep工具UI组件
 * 基于CC源码 cc_code/backend/tools/GrepTool/UI.tsx 实现
 */

import React from 'react';
import { Box, Text } from 'ink';

export interface GrepMatch {
  filePath: string;
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

export interface GrepOutput {
  pattern: string;
  matches: GrepMatch[];
  totalMatches: number;
}

export function renderToolUseMessage(
  input: Partial<{ pattern: string; path?: string }>,
  _options: { verbose: boolean }
): React.ReactNode {
  const { pattern, path } = input;
  if (!pattern) return null;

  const pathDisplay = path ? ` in ${path}` : '';
  return (
    <Text dimColor>
      Searching for: "{pattern}"{pathDisplay}
    </Text>
  );
}

export function renderToolResultMessage(
  output: GrepOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { matches, totalMatches, pattern } = output;

  if (matches.length === 0) {
    return <Text dimColor>No matches found for "{pattern}"</Text>;
  }

  const displayMatches = verbose ? matches : matches.slice(0, 10);

  return (
    <Box flexDirection="column">
      <Text color="green">
        ✓ Found {totalMatches} match{totalMatches !== 1 ? 'es' : ''}:
      </Text>
      <Box marginTop={1} flexDirection="column">
        {displayMatches.map((match, index) => (
          <Box key={index} flexDirection="column" marginTop={index > 0 ? 1 : 0}>
            <Box>
              <Text color="blue">{match.filePath}</Text>
              <Text dimColor>:{match.lineNumber}</Text>
            </Box>
            <Box paddingLeft={2}>
              <Text>{match.lineContent}</Text>
            </Box>
          </Box>
        ))}
      </Box>
      {!verbose && matches.length > 10 && (
        <Box marginTop={1}>
          <Text dimColor>... ({matches.length - 10} more matches)</Text>
        </Box>
      )}
    </Box>
  );
}

export function renderToolUseProgressMessage(): React.ReactNode {
  return <Text dimColor>Searching...</Text>;
}

export function getToolUseSummary(
  input: Partial<{ pattern: string }> | undefined
): string | null {
  if (!input?.pattern) return null;
  return `Search: "${input.pattern}"`;
}
