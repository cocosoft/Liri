/**
 * 文本输入管理Hook
 * 基于CC源码 cc_code/backend/hooks/useTextInput.ts 实现
 *
 * 支持：
 * - 多行输入
 * - 历史记录
 * - 自动补全
 */

import { useState, useCallback, useMemo, useEffect } from 'react';

/**
 * 历史记录条目
 */
export interface HistoryEntry {
  id: string;
  text: string;
  timestamp: Date;
}

/**
 * useTextInput Hook结果
 */
export interface UseTextInputResult {
  /** 当前输入值 */
  value: string;
  /** 是否为多行模式 */
  isMultiline: boolean;
  /** 历史记录 */
  history: HistoryEntry[];
  /** 历史记录索引（-1表示当前输入） */
  historyIndex: number;
  /** 当前行（多行模式下） */
  currentLine: number;
  /** 输入变化处理 */
  onChange: (value: string) => void;
  /** 设置多行模式 */
  setMultiline: (multiline: boolean) => void;
  /** 添加到历史记录 */
  addToHistory: (text: string) => void;
  /** 上一条历史 */
  previousHistory: () => void;
  /** 下一条历史 */
  nextHistory: () => void;
  /** 清空输入 */
  clear: () => void;
  /** 获取行内容 */
  getLine: (lineIndex: number) => string;
  /** 插入文本 */
  insertText: (text: string) => void;
}

/**
 * 生成唯一ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * useTextInput Hook
 * @param initialValue 初始值
 * @param options 配置选项
 * @returns 文本输入状态和操作方法
 */
export function useTextInput(
  initialValue: string = '',
  options: {
    maxHistory?: number;
    enableMultiline?: boolean;
  } = {}
): UseTextInputResult {
  const { maxHistory = 100, enableMultiline = true } = options;

  const [value, setValue] = useState(initialValue);
  const [isMultiline, setIsMultiline] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [currentLine, setCurrentLine] = useState(0);

  // 当值变化时更新当前行
  useEffect(() => {
    const lines = value.split('\n');
    setCurrentLine(lines.length);
  }, [value]);

  // 输入变化处理
  const onChange = useCallback((newValue: string) => {
    setValue(newValue);
    // 重置历史索引
    setHistoryIndex(-1);
  }, []);

  // 设置多行模式
  const setMultiline = useCallback((multiline: boolean) => {
    setIsMultiline(multiline);
    if (!multiline) {
      // 单行模式下移除换行
      setValue((prev) => prev.replace(/\n/g, ' '));
    }
  }, []);

  // 添加到历史记录
  const addToHistory = useCallback(
    (text: string) => {
      if (!text.trim()) return;

      // 避免重复添加
      if (history.length > 0 && history[0].text === text) return;

      const newEntry: HistoryEntry = {
        id: generateId(),
        text,
        timestamp: new Date(),
      };

      setHistory((prev) => [newEntry, ...prev].slice(0, maxHistory));
      setHistoryIndex(-1);
    },
    [history.length, maxHistory]
  );

  // 上一条历史
  const previousHistory = useCallback(() => {
    if (history.length === 0) return;

    const newIndex =
      historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex;
    setHistoryIndex(newIndex);
    setValue(history[newIndex].text);
  }, [history, historyIndex]);

  // 下一条历史
  const nextHistory = useCallback(() => {
    if (historyIndex <= 0) {
      setHistoryIndex(-1);
      setValue('');
      return;
    }

    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    setValue(history[newIndex].text);
  }, [history, historyIndex]);

  // 清空输入
  const clear = useCallback(() => {
    setValue('');
    setHistoryIndex(-1);
  }, []);

  // 获取行内容
  const getLine = useCallback(
    (lineIndex: number): string => {
      const lines = value.split('\n');
      return lines[lineIndex] || '';
    },
    [value]
  );

  // 插入文本
  const insertText = useCallback((text: string) => {
    setValue((prev) => prev + text);
  }, []);

  return {
    value,
    isMultiline,
    history,
    historyIndex,
    currentLine,
    onChange,
    setMultiline,
    addToHistory,
    previousHistory,
    nextHistory,
    clear,
    getLine,
    insertText,
  };
}

/**
 * 简化版useTextInput，仅用于单行输入
 */
export function useSingleLineInput(
  initialValue: string = ''
): Omit<
  UseTextInputResult,
  'isMultiline' | 'setMultiline' | 'currentLine' | 'getLine'
> {
  const result = useTextInput(initialValue, { enableMultiline: false });
  const { isMultiline, setMultiline, currentLine, getLine, ...rest } = result;
  return rest;
}
