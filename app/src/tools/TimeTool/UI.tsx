// import React from 'react'
import { Box, Text } from 'ink';

export type TimeOutput = {
  timezone: string;
  timestamp: number;
  iso: string;
  local: string;
  utc: string;
};

export function renderToolUseMessage(
  _input: Record<string, never>,
  _options: { verbose: boolean }
): React.ReactNode {
  return <Text dimColor>获取当前时间...</Text>;
}

export function renderToolResultMessage(
  output: TimeOutput,
  _progressMessages: any[],
  _options: { verbose: boolean }
): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text bold>当前时间</Text>
      <Box marginTop={1}>
        <Text>本地时间: {output.local}</Text>
      </Box>
      <Box>
        <Text dimColor>UTC时间: {output.utc}</Text>
      </Box>
      <Box>
        <Text dimColor>时区: {output.timezone}</Text>
      </Box>
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  _options: { verbose: boolean }
): React.ReactNode {
  return <Text color="red">获取时间失败: {error}</Text>;
}

export function getToolUseSummary(
  _input: Record<string, never> | undefined
): string | null {
  return '获取当前时间';
}
