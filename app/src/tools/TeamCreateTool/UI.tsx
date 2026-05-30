// import React from 'react'
import { Box, Text } from 'ink';

export type TeamOutput = {
  teamName?: string;
  memberCount?: number;
  members?: string[];
  action?: 'created' | 'deleted';
  error?: string;
};

export function renderToolUseMessage(
  input: Partial<{ team_name: string; agent_names: string[] }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { team_name, agent_names } = input;

  if (verbose && agent_names?.length) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text dimColor>Team: </Text>
          <Text bold>{team_name || 'new team'}</Text>
          <Text dimColor>
            {' '}
            ({agent_names.length} agent{agent_names.length !== 1 ? 's' : ''})
          </Text>
        </Box>
        <Box marginTop={1} marginLeft={2} flexDirection="column">
          {agent_names.map((name, i) => (
            <Box key={i} flexDirection="row">
              <Text dimColor>• {name}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text dimColor>Team: </Text>
      <Text bold>{team_name || 'new team'}</Text>
      {agent_names?.length ? (
        <Text dimColor> ({agent_names.length})</Text>
      ) : null}
    </Box>
  );
}

export function renderToolResultMessage(
  output: TeamOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { teamName, memberCount, members, action, error } = output;

  if (error) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="red">✗ Team operation failed</Text>
          {teamName ? <Text dimColor> [{teamName}]</Text> : null}
        </Box>
        <Box marginTop={1} marginLeft={2}>
          <Text color="red">{error.slice(0, 300)}</Text>
        </Box>
      </Box>
    );
  }

  if (verbose && members?.length) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">✓ </Text>
          <Text>
            Team {teamName || ''} {action || 'ready'}
          </Text>
          {memberCount !== undefined ? (
            <Text dimColor>
              {' '}
              ({memberCount} member{memberCount !== 1 ? 's' : ''})
            </Text>
          ) : null}
        </Box>
        <Box marginTop={1} marginLeft={2} flexDirection="column">
          {members.map((name, i) => (
            <Box key={i} flexDirection="row">
              <Text dimColor>• {name}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text color="green">✓ </Text>
      <Text>
        Team {teamName || ''} {action || 'ready'}
      </Text>
      {memberCount !== undefined ? (
        <Text dimColor> ({memberCount})</Text>
      ) : null}
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  _options: { verbose: boolean }
): React.ReactNode {
  return <Text color="red">团队操作失败: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ team_name: string }> | undefined
): string | null {
  if (!input?.team_name) return 'Team operation';
  return `Team: ${input.team_name}`;
}
