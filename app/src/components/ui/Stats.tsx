/**
 * Stats组件 - 统计信息展示
 * 用于显示Token消耗、成本、耗时、模型名称等统计信息
 */

import React from 'react';
import { Text, Box } from '../ink.js';

export interface StatsItem {
  label: string;
  value: string | number;
  color?: string;
  highlight?: boolean;
}

export interface StatsProps {
  items: StatsItem[];
  columns?: number;
  separator?: string;
  title?: string;
  titleColor?: string;
}

export function Stats({
  items,
  columns = 1,
  separator = ' │ ',
  title,
  titleColor = 'cyan',
}: StatsProps): React.ReactNode {
  if (items.length === 0) return null;

  if (columns <= 1) {
    return (
      <Box flexDirection="column" gap={0}>
        {title && (
          <Box marginBottom={1}>
            <Text bold color={titleColor}>
              {title}
            </Text>
          </Box>
        )}
        {items.map((item, idx) => (
          <Box key={idx} flexDirection="row" gap={1}>
            <Text dimColor>{item.label}:</Text>
            <Text color={item.color} bold={item.highlight}>
              {item.value}
            </Text>
          </Box>
        ))}
      </Box>
    );
  }

  const rows: StatsItem[][] = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }

  return (
    <Box flexDirection="column" gap={0}>
      {title && (
        <Box marginBottom={1}>
          <Text bold color={titleColor}>
            {title}
          </Text>
        </Box>
      )}
      {rows.map((row, rowIdx) => (
        <Box key={rowIdx} flexDirection="row">
          {row.map((item, colIdx) => (
            <Box key={colIdx} flexDirection="row">
              {colIdx > 0 && <Text dimColor>{separator}</Text>}
              <Text dimColor>{item.label}: </Text>
              <Text color={item.color} bold={item.highlight}>
                {item.value}
              </Text>
              {colIdx < row.length - 1 && <Text> </Text>}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

export interface TokenStatsProps {
  tokenCount?: number;
  costUSD?: number;
  durationMs?: number;
  modelName?: string;
  thinkingTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  showExtended?: boolean;
}

export function TokenStats({
  tokenCount,
  costUSD,
  durationMs,
  modelName,
  thinkingTokens,
  promptTokens,
  completionTokens,
  showExtended = false,
}: TokenStatsProps): React.ReactNode {
  const items: StatsItem[] = [];

  if (modelName) {
    items.push({ label: 'Model', value: modelName, color: 'cyan' });
  }

  if (tokenCount !== undefined) {
    const display =
      tokenCount >= 1000
        ? `${(tokenCount / 1000).toFixed(1)}k`
        : String(tokenCount);
    items.push({ label: 'Tokens', value: display, color: 'yellow' });
  }

  if (promptTokens !== undefined && showExtended) {
    items.push({
      label: 'Prompt',
      value: String(promptTokens),
      color: 'blue',
    });
  }

  if (completionTokens !== undefined && showExtended) {
    items.push({
      label: 'Completion',
      value: String(completionTokens),
      color: 'green',
    });
  }

  if (thinkingTokens !== undefined && showExtended) {
    items.push({
      label: 'Thinking',
      value: String(thinkingTokens),
      color: 'magenta',
    });
  }

  if (costUSD !== undefined && costUSD > 0) {
    items.push({
      label: 'Cost',
      value: `$${costUSD.toFixed(4)}`,
      color: 'red',
    });
  }

  if (durationMs !== undefined) {
    const sec = (durationMs / 1000).toFixed(1);
    items.push({ label: 'Time', value: `${sec}s`, color: 'green' });
  }

  if (items.length === 0) return null;

  return (
    <Box flexDirection="row" gap={0}>
      {items.map((item, idx) => (
        <Box key={idx} flexDirection="row">
          {idx > 0 && <Text dimColor> │ </Text>}
          <Text dimColor>{item.label}: </Text>
          <Text color={item.color} bold={item.highlight}>
            {item.value}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

export function createStats(
  items: StatsItem[],
  columns?: number
): React.ReactElement {
  return <Stats items={items} columns={columns} />;
}

export default Stats;
