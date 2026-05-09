//
/**
 * 底部信息栏组件（基于CC源码）
 * 提供底部信息显示功能，常用于显示快捷键提示等
 */

import React from 'react';
import { Box, Text } from '@modules/ink';
import { BylineProps, UITheme } from '../types/UITypes';
import { useTheme } from './ThemeProvider';

/**
 * 底部信息栏组件（基于CC源码）
 */
export function Byline({
  children,
  color = 'textSecondary',
  align = 'left',
  padding = 1,
}: BylineProps) {
  const { theme } = useTheme();

  return (
    <Box
      padding={padding}
      borderStyle="single"
      borderColor={theme.colors[color as keyof UITheme['colors']]}
      justifyContent={
        align === 'center'
          ? 'center'
          : align === 'right'
            ? 'flex-end'
            : 'flex-start'
      }
    >
      <Box flexDirection="row" alignItems="center" gap={1}>
        {children}
      </Box>
    </Box>
  );
}

/**
 * 状态信息栏组件（基于CC源码）
 */
export function StatusByline({
  status,
  message,
  color = 'textSecondary',
}: {
  status: 'success' | 'warning' | 'error' | 'info';
  message: string;
  color?: keyof UITheme['colors'];
}) {
  const { theme } = useTheme();

  const colors = theme.colors as Record<string, string>;

  const statusIcons = {
    success: '✓',
    warning: '⚠',
    error: '✗',
    info: 'ℹ',
  };

  const statusColors = {
    success: 'success',
    warning: 'warning',
    error: 'error',
    info: 'info',
  } as const;

  return (
    <Byline color={color}>
      <Text color={colors[statusColors[status]]}>{statusIcons[status]}</Text>
      <Text color={colors[color as string]}>{message}</Text>
    </Byline>
  );
}

/**
 * 进度信息栏组件（基于CC源码）
 */
export function ProgressByline({
  current,
  total,
  label,
  color = 'textSecondary',
}: {
  current: number;
  total: number;
  label?: string;
  color?: keyof UITheme['colors'];
}) {
  const { theme } = useTheme();
  const percentage = Math.round((current / total) * 100);

  return (
    <Byline color={color}>
      <Text color={theme.colors[color]}>
        {label || '进度'}: {current}/{total} ({percentage}%)
      </Text>
    </Byline>
  );
}

/**
 * 时间信息栏组件（基于CC源码）
 */
export function TimeByline({
  startTime,
  endTime,
  label,
  color = 'textSecondary',
}: {
  startTime: Date;
  endTime?: Date;
  label?: string;
  color?: keyof UITheme['colors'];
}) {
  const { theme } = useTheme();
  const duration = endTime
    ? endTime.getTime() - startTime.getTime()
    : Date.now() - startTime.getTime();
  const durationText = formatDuration(duration);

  return (
    <Byline color={color}>
      <Text color={theme.colors[color]}>
        {label || '耗时'}: {durationText}
      </Text>
    </Byline>
  );
}

/**
 * 格式化持续时间（基于CC源码）
 */
function formatDuration(duration: number): string {
  const seconds = Math.floor(duration / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * 计数信息栏组件（基于CC源码）
 */
export function CountByline({
  count,
  label,
  color = 'textSecondary',
}: {
  count: number;
  label: string;
  color?: keyof UITheme['colors'];
}) {
  const { theme } = useTheme();

  return (
    <Byline color={color}>
      <Text color={theme.colors[color]}>
        {label}: {count}
      </Text>
    </Byline>
  );
}

/**
 * 多信息底部栏组件（基于CC源码）
 */
export function MultiInfoByline({
  infos,
  color = 'textSecondary',
}: {
  infos: Array<{ label: string; value: string | number }>;
  color?: keyof UITheme['colors'];
}) {
  const { theme } = useTheme();

  return (
    <Byline color={color}>
      {infos.map((info, index) => (
        <React.Fragment key={index}>
          <Text color={theme.colors[color]}>
            {info.label}: {info.value}
          </Text>
          {index < infos.length - 1 && (
            <Text color={theme.colors[color]}>|</Text>
          )}
        </React.Fragment>
      ))}
    </Byline>
  );
}

export default Byline;
