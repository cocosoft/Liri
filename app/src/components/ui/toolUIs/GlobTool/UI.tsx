/**
 * Glob工具UI组件
 */

import React from 'react';
import { Box, Text } from '@modules/ink';

export interface GlobOutput {
  pattern: string;
  files: string[];
  totalCount: number;
}

export function renderToolUseMessage(
  input: Partial<{ pattern: string; cwd?: string }>,
  _options: { verbose: boolean }
): React.ReactNode {
  const { pattern, cwd } = input;
  if (!pattern) return null;

  const cwdDisplay = cwd ? ` in ${cwd}` : '';
  return (
    <Text dimColor>
      Finding files matching: "{pattern}"{cwdDisplay}
    </Text>
  );
}

export function renderToolResultMessage(
  output: GlobOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { files, totalCount, pattern } = output;

  if (files.length === 0) {
    return <Text dimColor>No files found matching "{pattern}"</Text>;
  }

  const displayFiles = verbose ? files : files.slice(0, 20);

  return (
    <Box flexDirection="column">
      <Text color="green">
        ✓ Found {totalCount} file{totalCount !== 1 ? 's' : ''}:
      </Text>
      <Box marginTop={1} flexDirection="column">
        {displayFiles.map((file, index) => (
          <Text key={index} color="blue">
            {file}
          </Text>
        ))}
      </Box>
      {!verbose && files.length > 20 && (
        <Box marginTop={1}>
          <Text dimColor>... ({files.length - 20} more files)</Text>
        </Box>
      )}
    </Box>
  );
}

export function renderToolUseProgressMessage(): React.ReactNode {
  return <Text dimColor>Finding files...</Text>;
}

export function renderToolUseErrorMessage(
  error: string,
  _options: { verbose: boolean }
): React.ReactNode {
  return <Text color="red">文件搜索失败: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ pattern: string }> | undefined
): string | null {
  if (!input?.pattern) return null;
  return `Glob: "${input.pattern}"`;
}
