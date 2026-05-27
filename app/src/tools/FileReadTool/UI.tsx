/**
 * FileRead工具UI组件
 * 基于CC源码 cc_code/backend/tools/FileReadTool/UI.tsx 实现
 */

import React from 'react';
import { Box, Text } from 'ink';

export interface FileReadOutput {
  content: string;
  filePath: string;
  totalLines: number;
  lineCount: number;
  offset: number;
  sizeBytes: number;
  truncated: boolean;
}

export function renderToolUseMessage(
  input: Partial<{ filePath: string; offset?: number; limit?: number }>,
  _options: { verbose: boolean }
): React.ReactNode {
  const { filePath, offset, limit } = input;
  if (!filePath) return null;

  let label = `Reading: ${filePath}`;
  if (offset || limit) {
    label += ` (lines ${offset || 1}-${offset && limit ? offset + limit - 1 : ''})`;
  }

  return <Text dimColor>{label}</Text>;
}

export function renderToolResultMessage(
  output: FileReadOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { content, filePath, totalLines, lineCount, truncated } = output;

  if (!content) {
    return <Text dimColor>File is empty</Text>;
  }

  if (verbose) {
    const lines = content.split('\n');
    const preview = lines.slice(0, 30).join('\n');
    const moreLines = lines.length - 30;

    return (
      <Box flexDirection="column">
        <Text color="blue">{filePath}</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Lines: {lineCount} of {totalLines} (
            {(output.sizeBytes / 1024).toFixed(1)} KB)
          </Text>
        </Box>
        <Box marginTop={1} borderStyle="single" paddingX={1}>
          <Text>{preview}</Text>
        </Box>
        {truncated || moreLines > 0 ? (
          <Box marginTop={1}>
            <Text dimColor>
              ... ({truncated ? totalLines - lineCount : moreLines} more lines)
            </Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  const firstLines = content.split('\n').slice(0, 5).join('\n');
  return (
    <Box flexDirection="column">
      <Text color="blue">{filePath}</Text>
      <Box marginTop={1} borderStyle="single" paddingX={1}>
        <Text>{firstLines}</Text>
      </Box>
      {truncated ? (
        <Box marginTop={1}>
          <Text dimColor>... (truncated, {totalLines} total lines)</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function renderToolUseProgressMessage(): React.ReactNode {
  return <Text dimColor>Reading file...</Text>;
}

export function getToolUseSummary(
  input: Partial<{ filePath: string }> | undefined
): string | null {
  if (!input?.filePath) return null;
  return `Read file: ${input.filePath}`;
}
