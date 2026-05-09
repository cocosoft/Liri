//
/**
 * 按钮组件（基于CC源码）
 * 提供各种类型的按钮功能
 */

import React from 'react';
import { Box, Text } from '../../ink';
import { ButtonProps } from '../types/UITypes';
import { useTheme } from '../design-system/ThemeProvider';

/**
 * 按钮组件（基于CC源码）
 */
export function Button({
  children,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  color = 'primary'
}: ButtonProps) {
  const { theme } = useTheme();

  /**
   * 处理点击事件（基于CC源码）
   */
  const handlePress = () => {
    if (!disabled && !loading && onPress) {
      onPress();
    }
  };

  /**
   * 获取按钮样式（基于CC源码）
   */
  const getButtonStyle = () => {
    const baseStyle = {
      padding: {
        xs: { horizontal: 1, vertical: 0.5 },
        sm: { horizontal: 1.5, vertical: 0.75 },
        md: { horizontal: 2, vertical: 1 },
        lg: { horizontal: 3, vertical: 1.5 }
      },
      fontSize: {
        xs: theme.typography.fontSize.xs,
        sm: theme.typography.fontSize.sm,
        md: theme.typography.fontSize.md,
        lg: theme.typography.fontSize.lg
      }
    };

    if (disabled) {
      return {
        backgroundColor: theme.colors.muted,
        color: theme.colors.textSecondary,
        borderColor: theme.colors.border,
        ...baseStyle
      };
    }

    if (loading) {
      return {
        backgroundColor: theme.colors.muted,
        color: theme.colors.textSecondary,
        borderColor: theme.colors.border,
        ...baseStyle
      };
    }

    switch (variant) {
      case 'primary':
        return {
          backgroundColor: theme.colors[color],
          color: theme.colors.background,
          borderColor: theme.colors[color],
          ...baseStyle
        };
      case 'secondary':
        return {
          backgroundColor: theme.colors.background,
          color: theme.colors[color],
          borderColor: theme.colors[color],
          ...baseStyle
        };
      case 'outline':
        return {
          backgroundColor: 'transparent',
          color: theme.colors[color],
          borderColor: theme.colors[color],
          ...baseStyle
        };
      case 'ghost':
        return {
          backgroundColor: 'transparent',
          color: theme.colors[color],
          borderColor: 'transparent',
          ...baseStyle
        };
      default:
        return {
          backgroundColor: theme.colors[color],
          color: theme.colors.background,
          borderColor: theme.colors[color],
          ...baseStyle
        };
    }
  };

  const style = getButtonStyle();
  const padding = style.padding[size];

  /**
   * 渲染加载状态（基于CC源码）
   */
  const renderContent = () => {
    if (loading) {
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text>…</Text>
          <Text>加载中</Text>
        </Box>
      );
    }

    return children;
  };

  return (
    <Box
      paddingLeft={padding.horizontal}
      paddingRight={padding.horizontal}
      paddingTop={padding.vertical}
      paddingBottom={padding.vertical}
      borderStyle="round"
      borderColor={style.borderColor}
      backgroundColor={style.backgroundColor}
      onPress={handlePress}
      focusable={!disabled && !loading}
    >
      <Text color={style.color}>
        {renderContent()}
      </Text>
    </Box>
  );
}

/**
 * 图标按钮组件（基于CC源码）
 */
export function IconButton({
  icon,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  color = 'primary'
}: ButtonProps & { icon: string }) {
  return (
    <Button
      onPress={onPress}
      variant={variant}
      size={size}
      disabled={disabled}
      loading={loading}
      color={color}
    >
      <Text>{icon}</Text>
    </Button>
  );
}

/**
 * 文本按钮组件（基于CC源码）
 */
export function TextButton({
  text,
  onPress,
  variant = 'ghost',
  size = 'md',
  disabled = false,
  loading = false,
  color = 'primary'
}: ButtonProps & { text: string }) {
  return (
    <Button
      onPress={onPress}
      variant={variant}
      size={size}
      disabled={disabled}
      loading={loading}
      color={color}
    >
      {text}
    </Button>
  );
}

/**
 * 图标文本按钮组件（基于CC源码）
 */
export function IconTextButton({
  icon,
  text,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  color = 'primary'
}: ButtonProps & { icon: string; text: string }) {
  return (
    <Button
      onPress={onPress}
      variant={variant}
      size={size}
      disabled={disabled}
      loading={loading}
      color={color}
    >
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text>{icon}</Text>
        <Text>{text}</Text>
      </Box>
    </Button>
  );
}

/**
 * 按钮组组件（基于CC源码）
 */
export function ButtonGroup({
  children,
  direction = 'horizontal',
  spacing = 1
}: {
  children: React.ReactNode;
  direction?: 'horizontal' | 'vertical';
  spacing?: number;
}) {
  return (
    <Box flexDirection={direction === 'horizontal' ? 'row' : 'column'} gap={spacing}>
      {children}
    </Box>
  );
}

export default Button;