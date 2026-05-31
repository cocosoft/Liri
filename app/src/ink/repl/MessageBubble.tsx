import React from 'react';
import { Box, Text } from '../../ink';
import { MarkdownRenderer } from '../../components/ui/markdown';
import type { DisplayMessage } from './types';

interface MessageBubbleProps {
  message: DisplayMessage;
}

/** 格式化时间戳为 HH:MM */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** 格式化 token 数：超过 1000 显示为 K 单位 */
function formatTokens(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}K`;
  }
  return String(n);
}

/** 格式化成本为美元显示 */
function formatCost(usd: number): string {
  if (usd < 0.0001) return '<$0.0001';
  return `$${usd.toFixed(4)}`;
}

/** 生成 assistant 消息的 token/成本 信息后缀 */
function buildCostSuffix(msg: DisplayMessage): string {
  if (!msg.tokenInfo) return '';

  const parts: string[] = [];
  const total = msg.tokenInfo.total;

  if (total > 0) {
    parts.push(`⚡${formatTokens(total)} tokens`);
  }

  if (msg.tokenInfo.cacheRead !== undefined && msg.tokenInfo.cacheRead > 0) {
    parts.push(`📖CR ${formatTokens(msg.tokenInfo.cacheRead)}`);
  }

  if (msg.tokenInfo.cacheCreation !== undefined && msg.tokenInfo.cacheCreation > 0) {
    parts.push(`✏️CW ${formatTokens(msg.tokenInfo.cacheCreation)}`);
  }

  if (msg.costUsd !== undefined && msg.costUsd > 0) {
    parts.push(`💰${formatCost(msg.costUsd)}`);
  }

  if (msg.sessionCostUsd !== undefined && msg.sessionCostUsd > 0) {
    parts.push(`累计 ${formatCost(msg.sessionCostUsd)}`);
  }

  return parts.length > 0 ? `  ${parts.join('  ')}` : '';
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isAssistant = message.role === 'assistant';

  const roleLabel = isUser ? '💬 You: ' : isSystem ? '⚙️ System: ' : '🤖 AI: ';
  const roleColor = isUser ? 'cyan' : isSystem ? 'yellow' : 'green';

  const timeStr = formatTime(message.timestamp);
  const costSuffix = isAssistant ? buildCostSuffix(message) : '';

  return (
    <Box flexDirection="column" marginBottom={1} paddingX={2}>
      <Box flexDirection="row">
        <Text color={roleColor} bold>
          {roleLabel}
        </Text>
        <Text color="gray">⏱ {timeStr}{costSuffix}</Text>
      </Box>
      <Box flexDirection="row" paddingLeft={2}>
        {isAssistant ? (
          <Box flexDirection="column">
            <MarkdownRenderer content={message.content} />
          </Box>
        ) : (
          <Text>{message.content}</Text>
        )}
      </Box>
    </Box>
  );
};
