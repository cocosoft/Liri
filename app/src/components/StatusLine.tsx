/**
 * StatusLine组件 - 状态栏
 * 实时显示模型名称、Token用量、Cost、运行时间等信息
 */

import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';

export interface StatusLineProps {
  /** 模型名称 */
  modelName?: string;
  /** Token用量 */
  tokens?: {
    input?: number;
    output?: number;
    total?: number;
  };
  /** 运行成本 */
  cost?: number;
  /** 运行时间（秒） */
  elapsedMs?: number;
  /** 状态文本 */
  statusText?: string;
  /** 是否繁忙 */
  busy?: boolean;
  /** 连接状态 */
  connectionStatus?: 'connected' | 'connecting' | 'disconnected' | 'error';
  /** Cron 下次唤醒时间 (ms) */
  cronNextWakeAt?: number;
  /** Cron 调度器是否启用 */
  cronEnabled?: boolean;
  /** 背景色 */
  backgroundColor?: string;
  /** 文本颜色 */
  textColor?: string;
  /** 是否显示 */
  visible?: boolean;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

function formatTokens(val?: number): string {
  if (val === undefined || val === 0) return '-';
  if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
  if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
  return String(val);
}

function formatCronNextWake(nextWakeMs: number, now: number): string {
  const diff = nextWakeMs - now;
  if (diff <= 0) return 'due';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const remainder = min % 60;
  if (hr < 24) return remainder > 0 ? `${hr}h${remainder}m` : `${hr}h`;
  const days = Math.floor(hr / 24);
  return `${days}d${hr % 24}h`;
}

export function StatusLine({
  modelName,
  tokens,
  cost,
  elapsedMs,
  statusText,
  busy = false,
  connectionStatus = 'connected',
  cronNextWakeAt,
  cronEnabled,
  backgroundColor = 'black',
  textColor = 'white',
  visible = true,
}: StatusLineProps): React.ReactNode {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!visible) return null;

  const statusDot = busy ? '●' : '○';
  const statusColor = busy ? 'green' : 'gray';

  const connIndicator: Record<string, { symbol: string; color: string }> = {
    connected: { symbol: '●', color: 'green' },
    connecting: { symbol: '◐', color: 'yellow' },
    disconnected: { symbol: '○', color: 'red' },
    error: { symbol: '✕', color: 'red' },
  };

  const conn = connIndicator[connectionStatus] || connIndicator.disconnected;

  const leftSection = (
    <Box>
      <Text color={conn.color}>{conn.symbol}</Text>
      <Text> </Text>
      <Text bold color={statusColor}>
        {statusDot}
      </Text>
      <Text> </Text>
      {modelName && <Text color="cyan">{modelName}</Text>}
      {statusText && (
        <>
          <Text> </Text>
          <Text color="gray" dim>
            {statusText}
          </Text>
        </>
      )}
    </Box>
  );

  const tokenSection = tokens && (
    <Box>
      <Text color="gray" dim>
        {'in:'}
      </Text>
      <Text color="yellow">{formatTokens(tokens.input)}</Text>
      <Text> </Text>
      <Text color="gray" dim>
        {'out:'}
      </Text>
      <Text color="yellow">{formatTokens(tokens.output)}</Text>
    </Box>
  );

  const rightSection = (
    <Box>
      {cronEnabled !== undefined && (
        <>
          <Text color={cronEnabled ? 'green' : 'gray'} dim>
            {cronEnabled ? '⏱' : '⏱'}
          </Text>
          {cronNextWakeAt !== undefined && cronNextWakeAt > 0 && (
            <Text color="gray" dim>
              {' '}{formatCronNextWake(cronNextWakeAt, now)}
            </Text>
          )}
          <Text> </Text>
        </>
      )}
      {cost !== undefined && cost > 0 && (
        <>
          <Text color="gray" dim>
            {'$'}
          </Text>
          <Text color="green">{cost.toFixed(4)}</Text>
          <Text> </Text>
        </>
      )}
      {elapsedMs !== undefined && (
        <Text color="gray" dim>
          {formatElapsed(elapsedMs + (now - Date.now()))}
        </Text>
      )}
    </Box>
  );

  return (
    <Box
      backgroundColor={backgroundColor as any}
      justifyContent="space-between"
      width="100%"
      paddingX={1}
    >
      {leftSection}
      {tokenSection}
      {rightSection}
    </Box>
  );
}
