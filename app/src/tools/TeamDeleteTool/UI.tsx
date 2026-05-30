// import React from 'react'
import { Box, Text } from 'ink';

export function renderToolUseMessage(
  input: Partial<{ team_name: string }>,
  _options: { verbose: boolean }
): React.ReactNode {
  return (
    <Box flexDirection="row">
      <Text dimColor>Delete team: </Text>
      <Text bold>{input.team_name || 'team'}</Text>
    </Box>
  );
}

export function renderToolResultMessage(
  output: { teamName?: string; error?: string },
  _progressMessages: any[],
  _options: { verbose: boolean }
): React.ReactNode {
  if (output.error) {
    return (
      <Box flexDirection="row">
        <Text color="red">✗ Failed to delete team</Text>
        {output.teamName ? <Text dimColor> [{output.teamName}]</Text> : null}
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text color="yellow">✓ </Text>
      <Text>Team {output.teamName || ''} deleted</Text>
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  _options: { verbose: boolean }
): React.ReactNode {
  return <Text color="red">删除团队失败: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ team_name: string }> | undefined
): string | null {
  if (!input?.team_name) return 'Delete team';
  return `Delete team: ${input.team_name}`;
}
