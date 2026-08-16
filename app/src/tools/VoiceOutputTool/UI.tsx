// import React from 'react'
import { Box, Text } from '@modules/ink';

export type VoiceOutputResult = {
  action: string;
  message: string;
  duration?: number;
  text_length?: number;
};

export function renderToolUseMessage(
  input: Partial<{ action: string; text: string }>,
  _options: { verbose: boolean }
): React.ReactNode {
  const { action, text } = input;
  if (action === 'speak') {
    return (
      <Text dimColor>
        朗读: {text ? text.slice(0, 50) : ''}
        {text && text.length > 50 ? '...' : ''}
      </Text>
    );
  }
  if (action === 'stop') {
    return <Text dimColor>停止朗读...</Text>;
  }
  return <Text dimColor>检查语音状态...</Text>;
}

export function renderToolResultMessage(
  output: VoiceOutputResult,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { action, message, duration, text_length } = output;

  if (action === 'speak') {
    return (
      <Box flexDirection="row">
        <Text color="green">✓ </Text>
        <Text dimColor>{message}</Text>
        {verbose && text_length ? (
          <Text dimColor> ({text_length}字)</Text>
        ) : null}
        {duration ? <Text dimColor> / {duration}ms</Text> : null}
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text color="green">✓ </Text>
      <Text dimColor>{message}</Text>
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  _options: { verbose: boolean }
): React.ReactNode {
  return <Text color="red">语音输出失败: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ action: string }> | undefined
): string | null {
  if (!input?.action) return null;
  return `语音输出: ${input.action}`;
}
