// import React from 'react'
import { Box, Text } from 'ink';

export type SkillOutput = {
  skillName?: string;
  skillType?: string;
  result?: string;
  error?: string;
};

export function renderToolUseMessage(
  input: Partial<{ name: string; arguments?: Record<string, unknown> }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { name, arguments: args } = input;
  if (!name) return null;

  if (verbose && args) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text dimColor>Running skill: </Text>
          <Text bold>{name}</Text>
        </Box>
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>
            {Object.entries(args)
              .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
              .join(', ')}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text dimColor>Running skill: </Text>
      <Text bold>{name}</Text>
    </Box>
  );
}

export function renderToolResultMessage(
  output: SkillOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { skillName, skillType, result, error } = output;

  if (error) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="red">✗ {skillName || 'skill'}</Text>
          {skillType ? <Text dimColor> [{skillType}]</Text> : null}
        </Box>
        <Box marginTop={1} marginLeft={2}>
          <Text color="red">{error.slice(0, 300)}</Text>
        </Box>
      </Box>
    );
  }

  if (verbose && result) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">✓ {skillName || 'skill'} completed</Text>
          {skillType ? <Text dimColor> [{skillType}]</Text> : null}
        </Box>
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>{result.slice(0, 500)}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text color="green">✓ </Text>
      <Text>{skillName || 'skill'} completed</Text>
      {skillType ? <Text dimColor> [{skillType}]</Text> : null}
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  _options: { verbose: boolean }
): React.ReactNode {
  return <Text color="red">Skill执行失败: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ name: string }> | undefined
): string | null {
  if (!input?.name) return null;
  return `Skill: ${input.name}`;
}
