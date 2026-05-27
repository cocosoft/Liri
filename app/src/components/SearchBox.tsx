/**
 * SearchBox组件 - 搜索框
 * 支持防抖输入、高亮匹配结果
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Text, Box } from 'ink';
import { useInput } from '../ink/ink/index.js';

export interface SearchMatch {
  index: number;
  text: string;
}

export interface SearchBoxProps {
  /** 搜索值 */
  value: string;
  /** 值变更回调 */
  onChange?: (value: string) => void;
  /** 搜索提交回调 */
  onSearch?: (value: string) => void;
  /** 占位文本 */
  placeholder?: string;
  /** 防抖延迟（毫秒） */
  debounceMs?: number;
  /** 匹配结果列表 */
  matches?: SearchMatch[];
  /** 当前选中匹配索引 */
  activeMatchIndex?: number;
  /** 匹配高亮颜色 */
  highlightColor?: string;
  /** 总结果数 */
  totalResults?: number;
  /** 焦点状态 */
  focus?: boolean;
  /** 是否禁用 */
  disabled?: boolean;
  /** 宽度 */
  width?: number;
}

export function SearchBox({
  value,
  onChange,
  onSearch,
  placeholder = '搜索...',
  debounceMs = 300,
  matches = [],
  activeMatchIndex = 0,
  highlightColor = 'yellow',
  totalResults,
  focus = true,
  disabled = false,
  width,
}: SearchBoxProps): React.ReactNode {
  const [cursorPos, setCursorPos] = useState(value.length);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (cursorPos > value.length) {
      setCursorPos(value.length);
    }
  }, [value, cursorPos]);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const handleChange = useCallback(
    (newValue: string) => {
      onChange?.(newValue);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        onSearch?.(newValue);
      }, debounceMs);
    },
    [onChange, onSearch, debounceMs]
  );

  useInput(
    (input, key) => {
      if (disabled || !focus) return;

      if (key.return) {
        onSearch?.(value);
        return;
      }
      if (key.backspace) {
        if (cursorPos <= 0) return;
        const newValue = value.slice(0, cursorPos - 1) + value.slice(cursorPos);
        handleChange(newValue);
        setCursorPos((prev) => prev - 1);
        return;
      }
      if (key.delete) {
        if (cursorPos >= value.length) return;
        const newValue = value.slice(0, cursorPos) + value.slice(cursorPos + 1);
        handleChange(newValue);
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
      if (key.escape) {
        handleChange('');
        setCursorPos(0);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        const newValue =
          value.slice(0, cursorPos) + input + value.slice(cursorPos);
        handleChange(newValue);
        setCursorPos((prev) => Math.min(prev + 1, newValue.length));
      }
    },
    { isActive: focus && !disabled }
  );

  const displayCount =
    totalResults !== undefined ? totalResults : matches.length;

  return (
    <Box flexDirection="column" width={width}>
      <Box>
        <Text color="cyan">🔍 </Text>
        {value.length === 0 ? (
          <Text color="gray">{placeholder}</Text>
        ) : (
          <>
            <Text>{value.slice(0, cursorPos)}</Text>
            {focus && <Text inverse>{value[cursorPos] || ' '}</Text>}
            <Text>{value.slice(cursorPos + 1)}</Text>
          </>
        )}
      </Box>
      {value.length > 0 && (
        <Box>
          <Text color="gray" dim>
            {displayCount > 0
              ? `找到 ${displayCount} 个结果${matches.length > 1 ? ` (${activeMatchIndex + 1}/${displayCount})` : ''}`
              : '无匹配结果'}
            {' | ESC 清除'}
          </Text>
        </Box>
      )}
      {matches.length > 0 && matches.length <= 5 && (
        <Box flexDirection="column" marginTop={1}>
          {matches.map((match, idx) => (
            <Box key={idx}>
              <Text
                color={idx === activeMatchIndex ? highlightColor : undefined}
              >
                {idx === activeMatchIndex ? '▸ ' : '  '}
                {match.text.slice(0, 80)}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
