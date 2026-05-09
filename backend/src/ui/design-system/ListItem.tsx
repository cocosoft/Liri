//
/**
 * 列表项组件（基于CC源码）
 * 提供列表项显示功能，支持选择、点击等交互
 */

import React from 'react';
import { Box, Text } from '@modules/ink';
import { ListItemProps } from '../types/UITypes';
import { useTheme } from './ThemeProvider';

/**
 * 列表项组件（基于CC源码）
 */
export function ListItem({
  children,
  onPress,
  selected = false,
  disabled = false,
  color = 'text',
  padding = 1,
  margin = 0,
}: ListItemProps) {
  const { theme } = useTheme();

  /**
   * 处理点击事件（基于CC源码）
   */
  const handlePress = () => {
    if (!disabled && onPress) {
      onPress();
    }
  };

  /**
   * 获取列表项样式（基于CC源码）
   */
  const getItemStyle = () => {
    if (disabled) {
      return {
        backgroundColor: theme.colors.muted,
        color: theme.colors.textSecondary,
        borderColor: theme.colors.border,
      };
    }

    if (selected) {
      return {
        backgroundColor: theme.colors.primary,
        color: theme.colors.background,
        borderColor: theme.colors.primary,
      };
    }

    return {
      backgroundColor: theme.colors.background,
      color: theme.colors[color],
      borderColor: theme.colors.border,
    };
  };

  const style = getItemStyle();

  return (
    <Box
      padding={padding}
      margin={margin}
      borderStyle="round"
      borderColor={style.borderColor}
      backgroundColor={style.backgroundColor}
      onPress={handlePress}
      focusable={!disabled}
    >
      <Text color={style.color}>{children}</Text>
    </Box>
  );
}

/**
 * 图标列表项组件（基于CC源码）
 */
export function IconListItem({
  icon,
  text,
  onPress,
  selected = false,
  disabled = false,
  color = 'text',
  padding = 1,
  margin = 0,
}: ListItemProps & { icon: string; text: string }) {
  const { theme } = useTheme();

  return (
    <ListItem
      onPress={onPress}
      selected={selected}
      disabled={disabled}
      color={color}
      padding={padding}
      margin={margin}
    >
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text>{icon}</Text>
        <Text>{text}</Text>
      </Box>
    </ListItem>
  );
}

/**
 * 描述列表项组件（基于CC源码）
 */
export function DescriptionListItem({
  title,
  description,
  onPress,
  selected = false,
  disabled = false,
  color = 'text',
  padding = 1,
  margin = 0,
}: ListItemProps & { title: string; description: string }) {
  const { theme } = useTheme();

  return (
    <ListItem
      onPress={onPress}
      selected={selected}
      disabled={disabled}
      color={color}
      padding={padding}
      margin={margin}
    >
      <Box flexDirection="column" gap={0.5}>
        <Text bold={true}>{title}</Text>
        <Text color={theme.colors.textSecondary}>{description}</Text>
      </Box>
    </ListItem>
  );
}

/**
 * 动作列表项组件（基于CC源码）
 */
export function ActionListItem({
  text,
  actionText,
  onPress,
  onActionPress,
  selected = false,
  disabled = false,
  color = 'text',
  padding = 1,
  margin = 0,
}: ListItemProps & {
  text: string;
  actionText: string;
  onActionPress: () => void;
}) {
  const { theme } = useTheme();

  return (
    <ListItem
      onPress={onPress}
      selected={selected}
      disabled={disabled}
      color={color}
      padding={padding}
      margin={margin}
    >
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
      >
        <Text>{text}</Text>
        <Box onPress={onActionPress} focusable={!disabled}>
          <Text color={theme.colors.primary}>{actionText}</Text>
        </Box>
      </Box>
    </ListItem>
  );
}

/**
 * 状态列表项组件（基于CC源码）
 */
export function StatusListItem({
  text,
  status,
  onPress,
  selected = false,
  disabled = false,
  color = 'text',
  padding = 1,
  margin = 0,
}: ListItemProps & {
  text: string;
  status: 'success' | 'warning' | 'error' | 'info' | 'loading';
}) {
  const { theme } = useTheme();

  const statusIcons = {
    success: '✓',
    warning: '⚠',
    error: '✗',
    info: 'ℹ',
    loading: '…',
  };

  const statusColors = {
    success: 'success',
    warning: 'warning',
    error: 'error',
    info: 'info',
    loading: 'textSecondary',
  };

  return (
    <ListItem
      onPress={onPress}
      selected={selected}
      disabled={disabled}
      color={color}
      padding={padding}
      margin={margin}
    >
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text
          color={
            theme.colors[statusColors[status] as keyof typeof theme.colors]
          }
        >
          {statusIcons[status]}
        </Text>
        <Text>{text}</Text>
      </Box>
    </ListItem>
  );
}

/**
 * 复选框列表项组件（基于CC源码）
 */
export function CheckboxListItem({
  text,
  checked,
  onToggle,
  disabled = false,
  color = 'text',
  padding = 1,
  margin = 0,
}: ListItemProps & {
  text: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const { theme } = useTheme();

  return (
    <ListItem
      onPress={() => onToggle(!checked)}
      selected={checked}
      disabled={disabled}
      color={color}
      padding={padding}
      margin={margin}
    >
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text color={theme.colors[checked ? 'success' : 'border']}>
          {checked ? '☑' : '☐'}
        </Text>
        <Text>{text}</Text>
      </Box>
    </ListItem>
  );
}

/**
 * 单选按钮列表项组件（基于CC源码）
 */
export function RadioListItem({
  text,
  selected,
  onSelect,
  disabled = false,
  color = 'text',
  padding = 1,
  margin = 0,
}: ListItemProps & { text: string; selected: boolean; onSelect: () => void }) {
  const { theme } = useTheme();

  return (
    <ListItem
      onPress={onSelect}
      selected={selected}
      disabled={disabled}
      color={color}
      padding={padding}
      margin={margin}
    >
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text color={theme.colors[selected ? 'primary' : 'border']}>
          {selected ? '●' : '○'}
        </Text>
        <Text>{text}</Text>
      </Box>
    </ListItem>
  );
}

export default ListItem;
