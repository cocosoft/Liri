// import React from 'react'
import { Box, Text } from '@modules/ink';

export type MonitorOutput = {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
};

export function renderToolUseMessage(
  input: Partial<{ type: string; target: string }>,
  _options: { verbose: boolean }
): React.ReactNode {
  const target = input.target || input.type || 'system';
  return <Text dimColor>监控 {target}...</Text>;
}

export function renderToolResultMessage(
  output: MonitorOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { type, data } = output;

  return (
    <Box flexDirection="column">
      <Text bold>监控报告 ({type})</Text>
      {verbose && data ? (
        <Box marginTop={1} flexDirection="column">
          {Object.entries(data).map(([key, value]) => (
            <Text key={key}>
              {key}:{' '}
              {typeof value === 'object'
                ? JSON.stringify(value)
                : String(value)}
            </Text>
          ))}
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text dimColor>{Object.keys(data || {}).length} 个指标</Text>
        </Box>
      )}
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  _options: { verbose: boolean }
): React.ReactNode {
  return <Text color="red">监控报告失败: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ type: string; target: string }> | undefined
): string | null {
  if (!input?.type && !input?.target) return '系统监控';
  return `监控 ${input.target || input.type}`;
}
