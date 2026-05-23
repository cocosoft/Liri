import React from 'react';
import { Box, Text } from '../../ink';
import type { StreamStats, StreamState } from './types';

interface StatusBarProps {
  streamStats: StreamStats | null;
  streamState: StreamState;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  streamStats,
  streamState,
}) => {
  const elapsed =
    streamStats && streamStats.startTime
      ? ((Date.now() - streamStats.startTime) / 1000).toFixed(1) + 's'
      : null;

  return (
    <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
      <Box flexDirection="row">
        {streamState === 'streaming' && (
          <Text color="yellow" dimColor>
            ⏳ 接收中...
          </Text>
        )}
        {streamState === 'paused' && (
          <Text color="yellow" dimColor>
            ⏸ 已暂停 — 按 ESC 恢复
          </Text>
        )}
        {streamState === 'done' && streamStats && (
          <Text color="green" dimColor>
            ✓ {streamStats.tokenCount} tokens | {streamStats.currentSpeed} t/s
            {elapsed ? ` | ${elapsed}` : ''}
          </Text>
        )}
        {streamState === 'idle' && (
          <Text dimColor>💬 输入消息，Enter 发送。 /help 查看命令。</Text>
        )}
      </Box>
    </Box>
  );
};
