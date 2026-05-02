/**
 * useStdin Hook
 * 提供标准输入流的访问和管理
 */

import { useEffect, useCallback, useState } from 'react';

export interface UseStdinOptions {
  /** 是否在挂载时开始监听 */
  listenOnMount?: boolean;
  /** 输入事件处理器 */
  onInput?: (input: string) => void;
  /** 按键事件处理器 */
  onKeyPress?: (key: string, event: any) => void;
}

export interface UseStdinReturn {
  /** 当前输入缓冲区 */
  input: string;
  /** 设置输入缓冲区 */
  setInput: (input: string) => void;
  /** 追加输入 */
  appendInput: (char: string) => void;
  /** 清除输入 */
  clearInput: () => void;
  /** 开始监听 */
  startListening: () => void;
  /** 停止监听 */
  stopListening: () => void;
  /** 是否正在监听 */
  isListening: boolean;
}

export function useStdin(options: UseStdinOptions = {}): UseStdinReturn {
  const { listenOnMount = true, onInput, onKeyPress } = options;
  const [input, setInputState] = useState('');
  const [isListening, setIsListening] = useState(false);
  const handlerRef = useCallback((data: Buffer) => {
    const inputString = data.toString();
    
    for (const char of inputString) {
      if (char === '\n' || char === '\r') {
        // 回车键，提交输入
        if (input) {
          onInput?.(input);
        }
        setInputState('');
      } else if (char === '\b' || char === '\x7f') {
        // 退格键
        setInputState((prev) => prev.slice(0, -1));
      } else {
        // 普通字符
        setInputState((prev) => prev + char);
        
        if (onKeyPress) {
          // 尝试解析特殊键
          const parsedKey = parseKey(char);
          onKeyPress(parsedKey || char, { char });
        }
      }
    }
  }, [input, onInput, onKeyPress]);

  const startListening = useCallback(() => {
    if (!isListening) {
      process.stdin.on('data', handlerRef);
      process.stdin.setRawMode(true);
      setIsListening(true);
    }
  }, [isListening, handlerRef]);

  const stopListening = useCallback(() => {
    if (isListening) {
      process.stdin.removeListener('data', handlerRef);
      process.stdin.setRawMode(false);
      setIsListening(false);
    }
  }, [isListening, handlerRef]);

  useEffect(() => {
    if (listenOnMount) {
      startListening();
    }

    return () => {
      stopListening();
    };
  }, [listenOnMount, startListening, stopListening]);

  const setInput = useCallback((newInput: string) => {
    setInputState(newInput);
  }, []);

  const appendInput = useCallback((char: string) => {
    setInputState((prev) => prev + char);
  }, []);

  const clearInput = useCallback(() => {
    setInputState('');
  }, []);

  return {
    input,
    setInput,
    appendInput,
    clearInput,
    startListening,
    stopListening,
    isListening,
  };
}

/**
 * 解析按键输入
 */
function parseKey(char: string): string | null {
  // 控制字符映射
  const controlMap: Record<string, string> = {
    '\x00': 'Ctrl+@',
    '\x01': 'Ctrl+A',
    '\x02': 'Ctrl+B',
    '\x03': 'Ctrl+C',
    '\x04': 'Ctrl+D',
    '\x05': 'Ctrl+E',
    '\x06': 'Ctrl+F',
    '\x07': 'Ctrl+G',
    '\x08': 'Ctrl+H',
    '\x09': 'Ctrl+I',
    '\x0a': 'Ctrl+J',
    '\x0b': 'Ctrl+K',
    '\x0c': 'Ctrl+L',
    '\x0d': 'Ctrl+M',
    '\x0e': 'Ctrl+N',
    '\x0f': 'Ctrl+O',
    '\x10': 'Ctrl+P',
    '\x11': 'Ctrl+Q',
    '\x12': 'Ctrl+R',
    '\x13': 'Ctrl+S',
    '\x14': 'Ctrl+T',
    '\x15': 'Ctrl+U',
    '\x16': 'Ctrl+V',
    '\x17': 'Ctrl+W',
    '\x18': 'Ctrl+X',
    '\x19': 'Ctrl+Y',
    '\x1a': 'Ctrl+Z',
    '\x1b': 'Escape',
    '\x7f': 'Backspace',
  };

  return controlMap[char] || null;
}
