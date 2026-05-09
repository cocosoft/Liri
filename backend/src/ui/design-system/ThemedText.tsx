/**
 * 主题化文本组件（基于CC源码）
 * 提供主题化的文本显示功能
 */

import React from 'react';
import { Text } from '@modules/ink';
import type { Styles } from '@modules/ink/ink/styles';
import { TextProps } from '../types/UITypes';
import { useTheme } from './ThemeProvider';

/**
 * 主题化文本组件（基于CC源码）
 */
export function ThemedText({
  children,
  color = 'text',
  bold = false,
  italic = false,
  underline = false,
  size = 'md',
  align = 'left',
  wrap = 'wrap',
}: TextProps) {
  const { theme } = useTheme();

  const wrapMap: Record<string, Styles['textWrap']> = {
    wrap: 'wrap',
    nowrap: 'truncate',
    truncate: 'truncate',
  };

  return (
    <Text
      color={theme.colors[color]}
      bold={bold}
      italic={italic}
      underline={underline}
      wrap={wrapMap[wrap]}
    >
      {children}
    </Text>
  );
}

/**
 * 标题文本组件（基于CC源码）
 */
export function HeadingText({
  children,
  level = 1,
  color = 'text',
  ...props
}: TextProps & { level?: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const sizes = ['xl', 'lg', 'md', 'sm', 'xs', 'xs'] as const;
  const size = sizes[level - 1] || 'md';

  return (
    <ThemedText color={color} size={size} bold={true} {...props}>
      {children}
    </ThemedText>
  );
}

/**
 * 副标题文本组件（基于CC源码）
 */
export function SubtitleText({
  children,
  color = 'textSecondary',
  ...props
}: TextProps) {
  return (
    <ThemedText color={color} size="sm" italic={true} {...props}>
      {children}
    </ThemedText>
  );
}

/**
 * 强调文本组件（基于CC源码）
 */
export function EmphasisText({
  children,
  color = 'primary',
  ...props
}: TextProps) {
  return (
    <ThemedText color={color} bold={true} {...props}>
      {children}
    </ThemedText>
  );
}

/**
 * 代码文本组件（基于CC源码）
 */
export function CodeText({ children, color = 'text', ...props }: TextProps) {
  return (
    <ThemedText color={color} size="sm" {...props}>
      {children}
    </ThemedText>
  );
}

/**
 * 链接文本组件（基于CC源码）
 */
export function LinkText({
  children,
  color = 'primary',
  onPress,
  ...props
}: TextProps & { onPress?: () => void }) {
  return (
    <ThemedText color={color} underline={true} {...props}>
      {children}
    </ThemedText>
  );
}

/**
 * 成功文本组件（基于CC源码）
 */
export function SuccessText({
  children,
  color = 'success',
  ...props
}: TextProps) {
  return (
    <ThemedText color={color} bold={true} {...props}>
      {children}
    </ThemedText>
  );
}

/**
 * 警告文本组件（基于CC源码）
 */
export function WarningText({
  children,
  color = 'warning',
  ...props
}: TextProps) {
  return (
    <ThemedText color={color} bold={true} {...props}>
      {children}
    </ThemedText>
  );
}

/**
 * 错误文本组件（基于CC源码）
 */
export function ErrorText({ children, color = 'error', ...props }: TextProps) {
  return (
    <ThemedText color={color} bold={true} {...props}>
      {children}
    </ThemedText>
  );
}

/**
 * 信息文本组件（基于CC源码）
 */
export function InfoText({ children, color = 'info', ...props }: TextProps) {
  return (
    <ThemedText color={color} bold={true} {...props}>
      {children}
    </ThemedText>
  );
}

/**
 * 静音文本组件（基于CC源码）
 */
export function MutedText({
  children,
  color = 'textSecondary',
  ...props
}: TextProps) {
  return (
    <ThemedText color={color} size="sm" {...props}>
      {children}
    </ThemedText>
  );
}

export default ThemedText;
