/**
 * useStdin Hook
 * 用于处理标准输入
 */

import { useEffect, useCallback, useState } from 'react';

export interface UseStdinOptions {
  onInput?: (input: string) => void;
  onKeyDown?: (key: string) => void;
  enabled?: boolean;
}

export interface UseStdinReturn {
  input: string;
  setInput: (input: string) => void;
}

export const useStdin = ({
  onInput,
  onKeyDown,
  enabled = true,
}: UseStdinOptions = {}): UseStdinReturn => {
  const [input, setInput] = useState('');

  const handleData = useCallback((data: Buffer) => {
    const inputString = data.toString().trim();
    
    if (inputString === '') {
      return;
    }

    setInput(inputString);
    
    if (onInput) {
      onInput(inputString);
    }
  }, [onInput]);

  const handleKeyPress = useCallback((str: string) => {
    if (onKeyDown) {
      onKeyDown(str);
    }
  }, [onKeyDown]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    process.stdin.on('data', handleData);
    process.stdin.on('keypress', handleKeyPress);

    return () => {
      process.stdin.off('data', handleData);
      process.stdin.off('keypress', handleKeyPress);
    };
  }, [enabled, handleData, handleKeyPress]);

  return {
    input,
    setInput,
  };
};