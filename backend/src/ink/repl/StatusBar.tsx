import React from 'react';
import { Box, Text } from '../../ink';
import type { StreamStats, StreamState } from './types';

interface StatusBarProps {
  streamStats: StreamStats | null;
  streamState: StreamState;
  submitCount: number;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  streamStats,
  streamState,
  submitCount,
}) => {
  const elapsed =
    streamStats && streamStats.startTime
      ? ((Date.now() - streamStats.startTime) / 1000).toFixed(1) + 's'
      : null;

  let statusText = '';
  let statusColor: 'yellow' | 'green' | 'white' = 'white';
  let isDim = true;

  if (streamState === 'streaming') {
    statusText = '⏳ 接收中...';
    statusColor = 'yellow';
  } else if (streamState === 'paused') {
    statusText = '⏸ 已暂停 — 按 ESC 恢复';
    statusColor = 'yellow';
  } else if (streamState === 'done' && streamStats) {
    statusText = `✓ ${streamStats.tokenCount} tokens | ${streamStats.currentSpeed} t/s${elapsed ? ` | ${elapsed}` : ''}`;
    statusColor = 'green';
  } else if (streamState === 'idle') {
    statusText = submitCount > 0
      ? `💬 [${submitCount}] 输入消息，Enter 发送。 /help 查看命令。`
      : '💬 输入消息，Enter 发送。 /help 查看命令。';
    statusColor = 'white';
  }

  return (
    <Box flexDirection="row" justifyContent="space-between" paddingX={1} borderTop>
      <Text color={statusColor} dimColor={isDim}>
        {statusText}
      </Text>
    </Box>
  );
};
