//
/**
 * 键盘快捷键提示组件（基于CC源码）
 * 显示键盘快捷键和描述信息
 */

import React from 'react';
import { Box, Text } from '@modules/ink';
import { KeyboardShortcutHintProps, UITheme } from '../types/UITypes';
import { useTheme } from './ThemeProvider';

/**
 * 键盘快捷键提示组件（基于CC源码）
 */
export function KeyboardShortcutHint({
  keys,
  description,
  color = 'textSecondary',
  size = 'md',
}: KeyboardShortcutHintProps) {
  const { theme } = useTheme();

  return (
    <Box flexDirection="row" alignItems="center" gap={1}>
      {/* 快捷键键位显示（基于CC源码） */}
      <Box
        flexDirection="row"
        gap={0.5}
        paddingLeft={0.5}
        paddingRight={0.5}
        borderStyle="round"
        borderColor={theme.colors[color]}
      >
        {keys.map((key, index) => (
          <React.Fragment key={key}>
            <Text color={theme.colors[color]}>{key}</Text>
            {index < keys.length - 1 && (
              <Text color={theme.colors[color]}>+</Text>
            )}
          </React.Fragment>
        ))}
      </Box>

      {/* 描述文本（基于CC源码） */}
      <Text color={theme.colors[color]}>{description}</Text>
    </Box>
  );
}

/**
 * 快捷键列表组件（基于CC源码）
 */
export function KeyboardShortcutList({
  shortcuts,
  color = 'textSecondary',
  size = 'md',
}: {
  shortcuts: Array<{ keys: string[]; description: string }>;
  color?: keyof UITheme['colors'];
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <Box flexDirection="column" gap={0.5}>
      {shortcuts.map((shortcut, index) => (
        <KeyboardShortcutHint
          key={index}
          keys={shortcut.keys}
          description={shortcut.description}
          color={color}
          size={size}
        />
      ))}
    </Box>
  );
}

export default KeyboardShortcutHint;
