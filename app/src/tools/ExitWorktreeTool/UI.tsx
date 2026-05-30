// import React from 'react'
import { Box, Text } from 'ink';

export function renderToolUseMessage(
  _input: Record<string, unknown>,
  _options: { verbose: boolean }
): React.ReactNode {
  return <Text dimColor>Exiting worktree...</Text>;
}

export function renderToolResultMessage(
  output: { error?: string },
  _progressMessages: any[],
  _options: { verbose: boolean }
): React.ReactNode {
  if (output.error) {
    return (
      <Box flexDirection="row">
        <Text color="red">✗ Failed to exit worktree</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text color="green">✓ </Text>
      <Text>Exited worktree</Text>
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  _options: { verbose: boolean }
): React.ReactNode {
  return <Text color="red">退出Worktree失败: {error}</Text>;
}

export function getToolUseSummary(
  _input: Record<string, unknown> | undefined
): string | null {
  return 'Exit worktree';
}
