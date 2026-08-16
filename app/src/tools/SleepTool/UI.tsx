// import React from 'react'
import { Box, Text } from '@modules/ink';

export type SleepOutput = {
  duration_ms: number;
  elapsed_ms: number;
};

export function renderToolUseMessage(
  input: Partial<{ duration_ms: number }>,
  _options: { verbose: boolean }
): React.ReactNode {
  const duration = input.duration_ms || 0;
  return <Text dimColor>等待 {duration}ms...</Text>;
}

export function renderToolResultMessage(
  output: SleepOutput,
  _progressMessages: any[],
  _options: { verbose: boolean }
): React.ReactNode {
  return (
    <Box>
      <Text dimColor>已等待 {output.elapsed_ms}ms</Text>
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  _options: { verbose: boolean }
): React.ReactNode {
  return <Text color="red">等待失败: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ duration_ms: number }> | undefined
): string | null {
  if (!input?.duration_ms) return null;
  return `等待 ${input.duration_ms}ms`;
}
