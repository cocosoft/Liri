/**
 * StatusBar 组件 — 轻量封装，委托给 StatusLine
 *
 * 将流式状态（streamState、streamStats）映射为 StatusLine 的统一 props，
 * 避免两套状态栏组件并行维护。
 */

import React from 'react';
import { StatusLine } from '../../components/StatusLine';
import type { StreamStats, StreamState } from './types';

interface StatusBarProps {
  streamStats: StreamStats | null;
  streamState: StreamState;
  submitCount: number;
  /** 当前模型名（来自 modelRouter 或 lastRouteDecision） */
  modelName?: string;
  /** 路由模式三态：dynamic / static / off */
  routingMode?: string;
  /** 路由层级 tier （仅 dynamic 模式时有效） */
  routerTier?: string;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  streamStats,
  streamState,
  submitCount,
  modelName,
  routingMode,
  routerTier,
}) => {
  // 拼接模型信息展示文字（dynamic:tier / off / static）
  const modelDisplay = modelName
    ? `${modelName}${routingMode === 'dynamic' && routerTier ? ` | ${routingMode}:${routerTier}` : routingMode && routingMode !== 'static' ? ` | ${routingMode}` : ''}`
    : undefined;

  // 将 streamState + streamStats 映射为 StatusLine 所需字段
  let busy = false;
  let statusText: string | undefined;
  let tokens: { input?: number; output?: number; total?: number } | undefined;
  let elapsedMs: number | undefined;

  if (streamState === 'streaming') {
    busy = true;
    statusText = '接收中...';
  } else if (streamState === 'paused') {
    statusText = '已暂停 — 按 ESC 恢复';
  } else if (streamState === 'done' && streamStats) {
    statusText = `${streamStats.tokenCount} tokens | ${streamStats.currentSpeed} t/s`;
    tokens = {
      total: streamStats.tokenCount,
    };
    elapsedMs = streamStats.startTime ? Date.now() - streamStats.startTime : undefined;
  } else if (streamState === 'idle') {
    statusText = submitCount > 0
      ? `💬 [${submitCount}] 输入消息，Enter 发送。 /help 查看命令。`
      : '💬 输入消息，Enter 发送。 /help 查看命令。';
  }

  return (
    <StatusLine
      modelName={modelDisplay}
      tokens={tokens}
      elapsedMs={elapsedMs}
      statusText={statusText}
      busy={busy}
      connectionStatus="connected"
    />
  );
};
