/**
 * FileWrite工具UI组件
 */

import React from 'react';
import { Box, Text } from 'ink';

export interface FileWriteOutput {
  filePath: string;
  sizeBytes: number;
  success: boolean;
}

export function renderToolUseMessage(
  input: Partial<{ filePath: string; content?: string }>,
  _options: { verbose: boolean }
): React.ReactNode {
  const { filePath, content } = input;
  if (!filePath) return null;

  const contentPreview = content ? ` (${content.length} chars)` : '';
  return (
    <Text dimColor>
      Writing: {filePath}
      {contentPreview}
    </Text>
  );
}

export function renderToolResultMessage(
  output: FileWriteOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { filePath, sizeBytes, success } = output;

  if (!success) {
    return <Text color="red">Failed to write file: {filePath}</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text color="green">✓ File written:</Text>
      <Text color="blue">{filePath}</Text>
      {verbose && (
        <Box marginTop={1}>
          <Text dimColor>Size: {(sizeBytes / 1024).toFixed(2)} KB</Text>
        </Box>
      )}
    </Box>
  );
}

export function renderToolUseProgressMessage(): React.ReactNode {
  return <Text dimColor>Writing file...</Text>;
}

export function getToolUseSummary(
  input: Partial<{ filePath: string }> | undefined
): string | null {
  if (!input?.filePath) return null;
  return `Write file: ${input.filePath}`;
}
