/**
 * useKeyboard Hook
 * 提供键盘事件处理功能
 */

import { useEffect, useCallback } from 'react';

export interface KeyHandler {
  (key: string): void;
}

export interface KeyboardOptions {
  target?: typeof process.stdin;
  onKeyDown?: KeyHandler;
  onKeyUp?: KeyHandler;
  onKeyPress?: KeyHandler;
}

export function useKeyboard(options: KeyboardOptions = {}): void {
  const { onKeyDown, onKeyUp, onKeyPress, target = process.stdin } = options;

  const handleData = useCallback(
    (data: Buffer) => {
      const key = data.toString();

      if (onKeyDown) {
        onKeyDown(key);
      }
    },
    [onKeyDown]
  );

  useEffect(() => {
    target.on('data', handleData);

    return () => {
      target.removeListener('data', handleData);
    };
  }, [target, handleData]);
}

/**
 * 创建键盘hook
 */
export function createUseKeyboard() {
  return useKeyboard;
}
