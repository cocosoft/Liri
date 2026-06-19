/**
 * StatusFloatingBar - floating status panel
 *
 * Floats at the bottom of the conversation panel, above the input area.
 * Replaces the old StatusBar that was in the cramped bottom section.
 */

import React from 'react';
import { Box, Text } from '../../ink';
import type { StreamStats, StreamState } from './types';

interface StatusFloatingBarProps {
  streamStats: StreamStats | null;
  streamState: StreamState;
  submitCount: number;
  modelName?: string;
}

function formatTokenSpeed(speed: number): string {
  if (speed >= 1000) return `${(speed / 1000).toFixed(1)}k t/s`;
  return `${speed} t/s`;
}

function formatElapsed(startTime: number): string {
  const sec = Math.floor((Date.now() - startTime) / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m${s}s`;
}

export const StatusFloatingBar: React.FC<StatusFloatingBarProps> = ({
  streamStats,
  streamState,
  submitCount,
  modelName,
}) => {
  let statusText: string;
  let statusColor: string;

  switch (streamState) {
    case 'streaming':
      statusText = '\u25cf 运行中';
      statusColor = 'green';
      break;
    case 'paused':
      statusText = '\u23f8 已暂停 — 按 ESC 继续';
      statusColor = 'yellow';
      break;
    case 'question':
      statusText = '\u2753 等待选择...';
      statusColor = 'yellow';
      break;
    case 'done':
      statusText = streamStats
        ? `Done ${streamStats.tokenCount} tokens ${formatTokenSpeed(streamStats.currentSpeed)}`
        : 'Done';
      statusColor = 'gray';
      break;
    case 'idle':
    default:
      statusText =
        submitCount > 0
          ? `\u{1F4AC} [${submitCount}] Type a message, Enter to send`
          : '\u{1F4AC} Type a message, Enter to send. /help for commands.';
      statusColor = 'gray';
      break;
  }

  const elapsed = streamStats?.startTime
    ? formatElapsed(streamStats.startTime)
    : null;

  return (
    <Box
      borderStyle="round"
      borderColor={statusColor as any}
      paddingX={1}
      paddingY={0}
      marginX={1}
      marginY={0}
      width="100%"
    >
      <Text color={statusColor as any}>{statusText}</Text>
      {modelName && (
        <>
          <Text> </Text>
          <Text color="cyan" dim>
            {modelName}
          </Text>
        </>
      )}
      {elapsed && (
        <>
          <Text> </Text>
          <Text color="gray" dim>
            {elapsed}
          </Text>
        </>
      )}
    </Box>
  );
};
