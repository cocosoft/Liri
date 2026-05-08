//
/**
 * 输入框组件（基于CC源码）
 * 提供文本输入功能，支持各种输入类型
 */

import React, { useState, useRef, useEffect } from 'react';
import { Box, Text } from '../../ink';
import { InputProps } from '../types/UITypes';
import { useTheme } from '../design-system/ThemeProvider';

/**
 * 输入框组件（基于CC源码）
 */
export function Input({
  value,
  onChange,
  placeholder = '',
  type = 'text',
  disabled = false,
  size = 'md',
  color = 'text',
  onFocus,
  onBlur,
  onKeyDown
}: InputProps) {
  const { theme } = useTheme();
  const [isFocused, setIsFocused] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * 处理焦点事件（基于CC源码）
   */
  const handleFocus = () => {
    if (!disabled) {
      setIsFocused(true);
      onFocus?.();
    }
  };

  /**
   * 处理失去焦点事件（基于CC源码）
   */
  const handleBlur = () => {
    setIsFocused(false);
    onBlur?.();
  };

  /**
   * 处理键盘输入（基于CC源码）
   */
  const handleInput = (input: string) => {
    if (disabled) return;

    let newValue = value;

    // 处理特殊按键（基于CC源码）
    if (input === '\b') {
      // 退格键
      if (cursorPosition > 0) {
        newValue = value.slice(0, cursorPosition - 1) + value.slice(cursorPosition);
        setCursorPosition(Math.max(0, cursorPosition - 1));
      }
    } else if (input === '\u007F') {
      // Delete键
      if (cursorPosition < value.length) {
        newValue = value.slice(0, cursorPosition) + value.slice(cursorPosition + 1);
      }
    } else if (input === '\u001B[D') {
      // 左箭头
      setCursorPosition(Math.max(0, cursorPosition - 1));
    } else if (input === '\u001B[C') {
      // 右箭头
      setCursorPosition(Math.min(value.length, cursorPosition + 1));
    } else if (input === '\u001B[H') {
      // Home键
      setCursorPosition(0);
    } else if (input === '\u001B[F') {
      // End键
      setCursorPosition(value.length);
    } else if (input === '\r' || input === '\n') {
      // Enter键
      onKeyDown?.({ key: 'Enter' } as any);
    } else if (input.length === 1 && !input.match(/[\x00-\x1F]/)) {
      // 普通字符
      newValue = value.slice(0, cursorPosition) + input + value.slice(cursorPosition);
      setCursorPosition(cursorPosition + 1);
    }

    if (newValue !== value) {
      onChange(newValue);
    }
  };

  /**
   * 处理键盘输入（基于CC源码）
   */
  useEffect(() => {
    // 这里简化处理，实际应该监听键盘输入
    // 由于ink.js没有提供useInput Hook，我们使用简化实现
    const handleKeyPress = (event: KeyboardEvent) => {
      if (!isFocused) return;
      
      // 简化处理，只处理字符输入
      if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        handleInput(event.key);
      }
      
      // 调用自定义按键处理
      onKeyDown?.({
        key: event.key,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        meta: event.metaKey
      } as any);
    };

    // 在实际的终端环境中，应该使用ink提供的输入处理
    // 这里只是简化实现
    document.addEventListener('keydown', handleKeyPress);
    
    return () => {
      document.removeEventListener('keydown', handleKeyPress);
    };
  }, [isFocused, value, cursorPosition]);

  /**
   * 获取输入框样式（基于CC源码）
   */
  const getInputStyle = () => {
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

    if (isFocused) {
      return {
        backgroundColor: theme.colors.background,
        color: theme.colors[color],
        borderColor: theme.colors.primary,
        ...baseStyle
      };
    }

    return {
      backgroundColor: theme.colors.background,
      color: theme.colors[color],
      borderColor: theme.colors.border,
      ...baseStyle
    };
  };

  const style = getInputStyle();
  const padding = style.padding[size];

  /**
   * 渲染输入内容（基于CC源码）
   */
  const renderContent = () => {
    if (value === '' && placeholder) {
      return (
        <Text color={theme.colors.textSecondary}>
          {placeholder}
        </Text>
      );
    }

    if (type === 'password') {
      return (
        <Text>
          {'•'.repeat(value.length)}
        </Text>
      );
    }

    return (
      <Text>
        {value}
      </Text>
    );
  };

  /**
   * 渲染光标（基于CC源码）
   */
  const renderCursor = () => {
    if (!isFocused || disabled) return null;

    const displayValue = type === 'password' ? '•'.repeat(value.length) : value;
    const beforeCursor = displayValue.slice(0, cursorPosition);
    const atCursor = displayValue.slice(cursorPosition, cursorPosition + 1) || ' ';

    return (
      <Box flexDirection="row">
        <Text>{beforeCursor}</Text>
        <Text backgroundColor={theme.colors.primary} color={theme.colors.background}>
          {atCursor}
        </Text>
        <Text>{displayValue.slice(cursorPosition + 1)}</Text>
      </Box>
    );
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
      onFocus={handleFocus}
      onBlur={handleBlur}
      focusable={!disabled}
    >
      {isFocused ? renderCursor() : renderContent()}
    </Box>
  );
}

/**
 * 文本区域组件（基于CC源码）
 */
export function TextArea({
  value,
  onChange,
  placeholder = '',
  disabled = false,
  rows = 3,
  size = 'md',
  color = 'text',
  onFocus,
  onBlur,
  onKeyDown
}: Omit<InputProps, 'type'> & { rows?: number }) {
  const { theme } = useTheme();
  const [isFocused, setIsFocused] = useState(false);

  /**
   * 处理焦点事件（基于CC源码）
   */
  const handleFocus = () => {
    if (!disabled) {
      setIsFocused(true);
      onFocus?.();
    }
  };

  /**
   * 处理失去焦点事件（基于CC源码）
   */
  const handleBlur = () => {
    setIsFocused(false);
    onBlur?.();
  };

  /**
   * 处理键盘输入（基于CC源码）
   */
  const handleInput = (input: string) => {
    if (disabled) return;

    if (input === '\r' || input === '\n') {
      // Enter键换行
      onChange(value + '\n');
    } else if (input === '\b') {
      // 退格键
      if (value.length > 0) {
        onChange(value.slice(0, -1));
      }
    } else if (input.length === 1 && !input.match(/[\x00-\x1F]/)) {
      // 普通字符
      onChange(value + input);
    }
  };

  /**
   * 处理键盘输入（基于CC源码）
   */
  useEffect(() => {
    // 这里简化处理，实际应该监听键盘输入
    // 由于ink.js没有提供useInput Hook，我们使用简化实现
    const handleKeyPress = (event: KeyboardEvent) => {
      if (!isFocused) return;
      
      // 简化处理，只处理字符输入
      if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        handleInput(event.key);
      }
      
      // 调用自定义按键处理
      onKeyDown?.({
        key: event.key,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        meta: event.metaKey
      } as any);
    };

    // 在实际的终端环境中，应该使用ink提供的输入处理
    // 这里只是简化实现
    document.addEventListener('keydown', handleKeyPress);
    
    return () => {
      document.removeEventListener('keydown', handleKeyPress);
    };
  }, [isFocused, value]);

  /**
   * 获取文本区域样式（基于CC源码）
   */
  const getTextAreaStyle = () => {
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

    if (isFocused) {
      return {
        backgroundColor: theme.colors.background,
        color: theme.colors[color],
        borderColor: theme.colors.primary,
        ...baseStyle
      };
    }

    return {
      backgroundColor: theme.colors.background,
      color: theme.colors[color],
      borderColor: theme.colors.border,
      ...baseStyle
    };
  };

  const style = getTextAreaStyle();
  const padding = style.padding[size];

  /**
   * 渲染内容（基于CC源码）
   */
  const renderContent = () => {
    if (value === '' && placeholder) {
      return (
        <Text color={theme.colors.textSecondary}>
          {placeholder}
        </Text>
      );
    }

    return (
      <Text>
        {value}
      </Text>
    );
  };

  return (
    <Box
      height={rows}
      paddingLeft={padding.horizontal}
      paddingRight={padding.horizontal}
      paddingTop={padding.vertical}
      paddingBottom={padding.vertical}
      borderStyle="round"
      borderColor={style.borderColor}
      backgroundColor={style.backgroundColor}
      onFocus={handleFocus}
      onBlur={handleBlur}
      focusable={!disabled}
    >
      {renderContent()}
    </Box>
  );
}

export default Input;