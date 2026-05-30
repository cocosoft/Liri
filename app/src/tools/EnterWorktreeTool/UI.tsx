// import React from 'react'
import { Box, Text } from 'ink';

export function renderToolUseMessage(
  input: Partial<{ path: string }>,
  _options: { verbose: boolean }
): React.ReactNode {
  return (
    <Box flexDirection="row">
      <Text dimColor>Enter worktree: </Text>
      <Text bold>{input.path || 'worktree'}</Text>
    </Box>
  );
}

export function renderToolResultMessage(
  output: { path?: string; error?: string },
  _progressMessages: any[],
  _options: { verbose: boolean }
): React.ReactNode {
  if (output.error) {
    return (
      <Box flexDirection="row">
        <Text color="red">✗ Failed to enter worktree</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text color="green">✓ </Text>
      <Text>Entered worktree: {output.path || 'ready'}</Text>
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  _options: { verbose: boolean }
): React.ReactNode {
  return <Text color="red">进入Worktree失败: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ path: string }> | undefined
): string | null {
  return `Enter worktree: ${input?.path || 'new'}`;
}
