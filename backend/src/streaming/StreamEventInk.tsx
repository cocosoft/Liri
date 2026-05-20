/**
 * StreamEventInk - Ink 流事件展示组件
 *
 * 提供 Ink React 组件，在终端中可视化流的新事件类型：
 * - 工具调用状态（tool_start / tool_progress / tool_end）
 * - 流控制状态（pause / resume / cancel）
 * - 性能指标（metrics）
 * - 进度展示（progress / done）
 */

import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from '../ui/ink';
import { StreamState } from './types';
import type { StreamEvent, StreamChunk } from './types';
import type { Stream } from './Stream';

// ============================================================
// 工具调用状态条
// ============================================================

interface ToolCallStatusProps {
  toolName: string;
  toolCallId: string;
  progress?: number;
  message?: string;
}

export function ToolCallStatus({
  toolName,
  toolCallId,
  progress,
  message,
}: ToolCallStatusProps) {
  const hasProgress = progress !== undefined;
  const progressBar = hasProgress
    ? `[${'█'.repeat(Math.floor(progress / 10))}${'░'.repeat(10 - Math.floor(progress / 10))}] ${progress}%`
    : '';

  return (
    <Box>
      <Text color="cyan">🔧 {toolName}</Text>
      <Text color="gray"> [{toolCallId.slice(0, 8)}]</Text>
      {progressBar && <Text> {progressBar}</Text>}
      {message && <Text color="gray"> {message}</Text>}
    </Box>
  );
}

// ============================================================
// 流控制状态指示器
// ============================================================

interface StreamControlIndicatorProps {
  state: StreamState;
  reason?: string;
}

export function StreamControlIndicator({
  state,
  reason,
}: StreamControlIndicatorProps) {
  switch (state) {
    case StreamState.PAUSED:
      return (
        <Box>
          <Text color="yellow">⏸ 已暂停</Text>
          {reason && <Text color="gray"> ({reason})</Text>}
        </Box>
      );
    case StreamState.CANCELLED:
      return (
        <Box>
          <Text color="red">⛔ 已取消</Text>
          {reason && <Text color="gray"> ({reason})</Text>}
        </Box>
      );
    case StreamState.COMPLETED:
      return (
        <Box>
          <Text color="green">✅ 完成</Text>
        </Box>
      );
    case StreamState.ERROR:
      return (
        <Box>
          <Text color="red">❌ 错误</Text>
          {reason && <Text color="gray"> ({reason})</Text>}
        </Box>
      );
    case StreamState.STREAMING:
      return (
        <Box>
          <Text color="green">▶ 流式输出中</Text>
        </Box>
      );
    default:
      return null;
  }
}

// ============================================================
// 性能指标显示
// ============================================================

interface MetricsDisplayProps {
  tokenCount: number;
  speed: number;
  elapsedMs: number;
  estimatedCost?: number;
}

export function MetricsDisplay({
  tokenCount,
  speed,
  elapsedMs,
  estimatedCost,
}: MetricsDisplayProps) {
  const elapsed = (elapsedMs / 1000).toFixed(1);

  return (
    <Box>
      <Text color="gray">📊 </Text>
      <Text color="gray">{tokenCount} tokens</Text>
      <Text color="gray"> | </Text>
      <Text color="gray">{speed} t/s</Text>
      <Text color="gray"> | </Text>
      <Text color="gray">{elapsed}s</Text>
      {estimatedCost !== undefined && (
        <>
          <Text color="gray"> | </Text>
          <Text color="gray">${estimatedCost.toFixed(4)}</Text>
        </>
      )}
    </Box>
  );
}

// ============================================================
// 进度条
// ============================================================

interface ProgressBarProps {
  percent: number;
  current: number;
  total: number;
  label?: string;
}

export function ProgressBar({
  percent,
  current,
  total,
  label,
}: ProgressBarProps) {
  const barWidth = 20;
  const filled = Math.floor((percent / 100) * barWidth);
  const bar = `${'█'.repeat(filled)}${'░'.repeat(barWidth - filled)}`;

  return (
    <Box>
      {label && <Text>{label} </Text>}
      <Text color="cyan">{bar}</Text>
      <Text> {percent}%</Text>
      <Text color="gray">
        {' '}
        ({current}/{total})
      </Text>
    </Box>
  );
}

// ============================================================
// 完整流状态面板
// ============================================================

interface StreamStatusPanelProps {
  stream: Stream<StreamChunk>;
  showMetrics?: boolean;
  showToolCalls?: boolean;
}

export function StreamStatusPanel({
  stream,
  showMetrics = true,
  showToolCalls = true,
}: StreamStatusPanelProps) {
  const [state, setState] = useState<StreamState>(StreamState.IDLE);
  const [tokenCount, setTokenCount] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [estimatedCost, setEstimatedCost] = useState<number | undefined>();
  const [activeTools, setActiveTools] = useState<
    Map<string, { name: string; progress: number; message?: string }>
  >(new Map());
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [paused, setPaused] = useState(false);
  const [cancelReason, setCancelReason] = useState<string | undefined>();
  const [show, setShow] = useState(true);

  useEffect(() => {
    const unsubEvent = stream.onEvent((event: StreamEvent) => {
      switch (event.type) {
        case 'start':
          setState(StreamState.STREAMING);
          break;
        case 'token':
          setTokenCount((prev) => prev + 1);
          break;
        case 'progress':
          setProgress({ current: event.current, total: event.total });
          break;
        case 'done':
          setState(StreamState.COMPLETED);
          setSpeed(event.tokenSpeed);
          setElapsedMs(event.totalDuration);
          break;
        case 'pause':
          setPaused(true);
          setCancelReason(event.reason);
          break;
        case 'resume':
          setPaused(false);
          break;
        case 'cancel':
          setState(StreamState.CANCELLED);
          setCancelReason(event.reason);
          break;
        case 'metrics':
          setTokenCount(event.tokenCount);
          setSpeed(event.speed);
          setElapsedMs(event.elapsedMs);
          if (event.estimatedCost !== undefined) {
            setEstimatedCost(event.estimatedCost);
          }
          break;
        case 'tool_start':
          if (showToolCalls) {
            setActiveTools((prev) => {
              const next = new Map(prev);
              next.set(event.toolCallId, { name: event.toolName, progress: 0 });
              return next;
            });
          }
          break;
        case 'tool_progress':
          if (showToolCalls) {
            setActiveTools((prev) => {
              const next = new Map(prev);
              const existing = next.get(event.toolCallId);
              if (existing) {
                next.set(event.toolCallId, {
                  ...existing,
                  progress: event.progress,
                  message: event.message,
                });
              }
              return next;
            });
          }
          break;
        case 'tool_end':
          if (showToolCalls) {
            setActiveTools((prev) => {
              const next = new Map(prev);
              next.delete(event.toolCallId);
              return next;
            });
          }
          break;
      }
    });

    return () => {
      unsubEvent();
    };
  }, [stream, showToolCalls]);

  if (!show) return null;

  return (
    <Box flexDirection="column">
      {/* 流状态 */}
      <Box>
        <StreamControlIndicator state={state} reason={cancelReason} />
        {paused && state !== StreamState.CANCELLED && (
          <Text color="yellow"> ⏸</Text>
        )}
      </Box>

      {/* 进度条 */}
      {progress && (
        <ProgressBar
          percent={Math.round((progress.current / progress.total) * 100)}
          current={progress.current}
          total={progress.total}
        />
      )}

      {/* 活跃工具调用 */}
      {showToolCalls && activeTools.size > 0 && (
        <Box flexDirection="column">
          {Array.from(activeTools.entries()).map(([id, tool]) => (
            <ToolCallStatus
              key={id}
              toolName={tool.name}
              toolCallId={id}
              progress={tool.progress}
              message={tool.message}
            />
          ))}
        </Box>
      )}

      {/* 性能指标 */}
      {showMetrics && state === StreamState.STREAMING && (
        <MetricsDisplay
          tokenCount={tokenCount}
          speed={speed}
          elapsedMs={elapsedMs}
          estimatedCost={estimatedCost}
        />
      )}
    </Box>
  );
}

// ============================================================
// 事件日志列表
// ============================================================

interface EventLogProps {
  stream: Stream<StreamChunk>;
  maxEntries?: number;
}

export function EventLog({ stream, maxEntries = 20 }: EventLogProps) {
  const [entries, setEntries] = useState<
    Array<{ type: string; summary: string; timestamp: number }>
  >([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = stream.onEvent((event: StreamEvent) => {
      const summary = summarizeEvent(event);
      if (summary) {
        setEntries((prev) => {
          const next = [
            ...prev,
            { type: event.type, summary, timestamp: Date.now() },
          ];
          return next.length > maxEntries
            ? next.slice(next.length - maxEntries)
            : next;
        });
      }
    });
    return () => unsub();
  }, [stream, maxEntries]);

  if (entries.length === 0) return null;

  return (
    <Box flexDirection="column">
      <Text bold underline>
        事件日志
      </Text>
      {entries.map((entry, i) => (
        <Box key={i}>
          <Text color="gray">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </Text>
          <Text> </Text>
          <Text color={getEventColor(entry.type)}>{entry.type}</Text>
          <Text color="gray"> {entry.summary}</Text>
        </Box>
      ))}
    </Box>
  );
}

function summarizeEvent(event: StreamEvent): string | null {
  switch (event.type) {
    case 'start':
      return `model=${event.model}`;
    case 'token':
      return null;
    case 'progress':
      return `${Math.round((event.current / event.total) * 100)}% (${event.current}/${event.total})`;
    case 'done':
      return `${event.totalTokens} tokens in ${(event.totalDuration / 1000).toFixed(1)}s`;
    case 'yield':
      return `原因: ${event.reason}`;
    case 'pause':
      return event.reason ? `原因: ${event.reason}` : '';
    case 'resume':
      return event.reason ? `原因: ${event.reason}` : '';
    case 'cancel':
      return event.reason ? `原因: ${event.reason}` : '';
    case 'metrics':
      return `${event.tokenCount} tok, ${event.speed} t/s`;
    case 'tool_start':
      return `${event.toolName}[${event.toolCallId.slice(0, 8)}]`;
    case 'tool_end':
      return `${event.toolName} (${event.duration}ms)`;
    case 'tool_progress':
      return `${event.toolName}: ${event.progress}%`;
    default:
      return null;
  }
}

function getEventColor(type: string): string {
  switch (type) {
    case 'start':
    case 'resume':
      return 'green';
    case 'done':
    case 'tool_end':
      return 'green';
    case 'pause':
    case 'yield':
      return 'yellow';
    case 'cancel':
      return 'red';
    case 'error':
      return 'red';
    case 'tool_start':
      return 'cyan';
    case 'tool_progress':
      return 'blue';
    case 'metrics':
      return 'gray';
    default:
      return 'white';
  }
}
