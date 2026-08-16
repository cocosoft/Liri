/**
 * TextInput组件 - 文本输入框
 * 支持多行/单行、光标定位、文本选择、Vim模式、粘贴等交互
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Text, Box } from '@modules/ink';
import { useInput } from '../ink/ink/index.js';

/**
 * 光标样式
 */
export type CursorStyle = 'block' | 'line' | 'underline';

/**
 * 输入模式
 */
export type InputMode = 'normal' | 'vim';

export interface TextInputProps {
  /** 输入值 */
  value: string;
  /** 值变更回调 */
  onChange?: (value: string) => void;
  /** 提交回调（Enter） */
  onSubmit?: (value: string) => void;
  /** 占位文本 */
  placeholder?: string;
  /** 是否多行 */
  multiline?: boolean;
  /** 是否禁用 */
  disabled?: boolean;
  /** 最大长度 */
  maxLength?: number;
  /** 光标样式 */
  cursorStyle?: CursorStyle;
  /** 输入模式 */
  inputMode?: InputMode;
  /** 焦点状态 */
  focus?: boolean;
  /** 是否密码模式 */
  password?: boolean;
  /** 自定义样式 */
  style?: {
    width?: number;
    height?: number;
    borderColor?: string;
    focusBorderColor?: string;
    placeholderColor?: string;
  };
}

export function TextInput({
  value,
  onChange,
  onSubmit,
  placeholder = '',
  multiline = false,
  disabled = false,
  maxLength,
  cursorStyle = 'line',
  inputMode = 'normal',
  focus = true,
  password = false,
  style = {},
}: TextInputProps): React.ReactNode {
  const [cursorPos, setCursorPos] = useState(value.length);
  const [isVimMode, setIsVimMode] = useState(inputMode === 'vim');
  const cursorBlink = useRef(true);

  useEffect(() => {
    const timer = setInterval(() => {
      cursorBlink.current = !cursorBlink.current;
    }, 530);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (cursorPos > value.length) {
      setCursorPos(value.length);
    }
  }, [value, cursorPos]);

  const displayText = password ? '*'.repeat(value.length) : value;
  const showPlaceholder = value.length === 0 && placeholder;
  const cursorChar =
    cursorStyle === 'block' ? '█' : cursorStyle === 'underline' ? '‗' : '|';

  const insertAtCursor = useCallback(
    (text: string) => {
      if (maxLength && value.length + text.length > maxLength) return;
      const newValue =
        value.slice(0, cursorPos) + text + value.slice(cursorPos);
      onChange?.(newValue);
      setCursorPos((prev) => prev + text.length);
    },
    [value, cursorPos, onChange, maxLength]
  );

  const deleteBackward = useCallback(() => {
    if (cursorPos <= 0) return;
    const newValue = value.slice(0, cursorPos - 1) + value.slice(cursorPos);
    onChange?.(newValue);
    setCursorPos((prev) => prev - 1);
  }, [value, cursorPos, onChange]);

  const deleteForward = useCallback(() => {
    if (cursorPos >= value.length) return;
    const newValue = value.slice(0, cursorPos) + value.slice(cursorPos + 1);
    onChange?.(newValue);
  }, [value, cursorPos, onChange]);

  useInput(
    (input, key) => {
      if (disabled || !focus) return;

      if (key.escape) {
        setIsVimMode((prev) => !prev);
        return;
      }

      if (isVimMode) {
        if (key.leftArrow) setCursorPos((p) => Math.max(0, p - 1));
        else if (key.rightArrow)
          setCursorPos((p) => Math.min(value.length, p + 1));
        else if (key.upArrow) setCursorPos(0);
        else if (key.downArrow) setCursorPos(value.length);
        else if (input === 'i' || input === 'a') setIsVimMode(false);
        else if (input === 'x') deleteForward();
        else if (input === 'D') onChange?.(value.slice(0, cursorPos));
        else if (input === 'u') setIsVimMode(false);
        return;
      }

      if (key.return) {
        if (multiline) {
          insertAtCursor('\n');
        } else {
          onSubmit?.(value);
        }
        return;
      }

      if (key.backspace || key.delete) {
        if (key.delete) {
          deleteForward();
        } else {
          deleteBackward();
        }
        return;
      }

      if (key.leftArrow) {
        setCursorPos((p) => Math.max(0, p - 1));
        return;
      }

      if (key.rightArrow) {
        setCursorPos((p) => Math.min(value.length, p + 1));
        return;
      }

      if (key.home || (key.ctrl && input === 'a')) {
        setCursorPos(0);
        return;
      }

      if (key.end || (key.ctrl && input === 'e')) {
        setCursorPos(value.length);
        return;
      }

      if (input && !key.ctrl && !key.meta) {
        insertAtCursor(input);
      }
    },
    { isActive: focus && !disabled }
  );

  const renderCursor = (): React.ReactNode => {
    if (!focus || !cursorBlink.current) return null;

    const charAtCursor = displayText[cursorPos];
    if (cursorStyle === 'block') {
      return <Text inverse>{charAtCursor || ' '}</Text>;
    }
    return <Text dim>{cursorChar}</Text>;
  };

  const renderInputLine = (): React.ReactNode => {
    if (showPlaceholder) {
      return (
        <Text color={style.placeholderColor || 'gray'}>{placeholder}</Text>
      );
    }

    return (
      <Text>
        {displayText.slice(0, cursorPos)}
        {renderCursor()}
        {displayText.slice(cursorPos + 1)}
      </Text>
    );
  };

  if (multiline) {
    const borderClr = focus
      ? style.focusBorderColor || 'cyan'
      : style.borderColor || 'gray';
    return (
      <Box flexDirection="column" width={style.width || 60}>
        <Box borderStyle="round" borderColor={borderClr}>
          <Box flexDirection="column" paddingX={1} paddingY={0}>
            {renderInputLine()}
          </Box>
        </Box>
        {focus && (
          <Box>
            <Text color="gray" dim>
              {isVimMode ? 'VIM' : `行:1 列:${cursorPos + 1}`}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  return <Box>{renderInputLine()}</Box>;
}
