import React from 'react';
import { Box, Text } from '../../ink';
import type { ToolCallInfo, ActiveToolCall } from './types';

interface ToolCallPanelProps {
  activeToolCalls: ActiveToolCall[];
  completedToolCalls?: ToolCallInfo[];
}

export const ToolCallPanel: React.FC<ToolCallPanelProps> = ({
  activeToolCalls,
  completedToolCalls,
}) => {
  if (
    activeToolCalls.length === 0 &&
    (!completedToolCalls || completedToolCalls.length === 0)
  ) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1} paddingX={2}>
      {activeToolCalls.map((tc) => (
        <Box key={tc.toolCallId} flexDirection="row">
          <Text color="cyan">🔧 {tc.toolName}</Text>
          <Text color="gray"> [{tc.toolCallId.slice(0, 8)}]</Text>
          <Text color="yellow">
            {' '}
            {tc.status === 'running' ? '执行中...' : '已完成'}
          </Text>
        </Box>
      ))}
      {completedToolCalls?.map((tc) => (
        <Box key={tc.id} flexDirection="row">
          <Text color="cyan">🔧 {tc.name}</Text>
          <Text color="gray"> [{tc.id.slice(0, 8)}]</Text>
          <Text color="green"> 已完成</Text>
        </Box>
      ))}
    </Box>
  );
};
