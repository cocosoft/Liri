/**
 * useFocus Hook
 * 提供焦点管理功能
 */

import { useState, useCallback, useEffect } from 'react';

export interface FocusOptions {
  initialFocus?: boolean;
  onFocusChange?: (isFocused: boolean) => void;
}

export function useFocus(options: FocusOptions = {}): {
  isFocused: boolean;
  focus: () => void;
  blur: () => void;
  toggle: () => void;
} {
  const [isFocused, setIsFocused] = useState(options.initialFocus || false);

  const focus = useCallback(() => {
    setIsFocused(true);
    options.onFocusChange?.(true);
  }, [options]);

  const blur = useCallback(() => {
    setIsFocused(false);
    options.onFocusChange?.(false);
  }, [options]);

  const toggle = useCallback(() => {
    setIsFocused((prev) => {
      const newValue = !prev;
      options.onFocusChange?.(newValue);
      return newValue;
    });
  }, [options]);

  // 自动聚焦（如果初始设置为true）
  useEffect(() => {
    if (options.initialFocus) {
      focus();
    }
  }, []);

  return { isFocused, focus, blur, toggle };
}

/**
 * 创建焦点hook
 */
export function createUseFocus() {
  return useFocus;
}
