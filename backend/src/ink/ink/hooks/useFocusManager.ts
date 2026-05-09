/**
 * useFocusManager Hook
 * 提供焦点组管理功能，支持Tab键切换焦点
 */

import { useState, useCallback, useEffect, useRef } from 'react';

export interface FocusableElement {
  id: string;
  focus: () => void;
  blur: () => void;
  isFocused: boolean;
}

export function useFocusManager(initialFocusId?: string): {
  focusables: FocusableElement[];
  registerFocusable: (element: FocusableElement) => void;
  unregisterFocusable: (id: string) => void;
  focusNext: () => void;
  focusPrev: () => void;
  focusById: (id: string) => void;
  currentFocusId: string | null;
} {
  const [focusables, setFocusables] = useState<FocusableElement[]>([]);
  const [currentFocusId, setCurrentFocusId] = useState<string | null>(
    initialFocusId || null
  );
  const initialized = useRef(false);

  // 注册可聚焦元素
  const registerFocusable = useCallback((element: FocusableElement) => {
    setFocusables((prev) => {
      const exists = prev.find((f) => f.id === element.id);
      if (exists) {
        return prev.map((f) => (f.id === element.id ? element : f));
      }
      return [...prev, element];
    });
  }, []);

  // 注销可聚焦元素
  const unregisterFocusable = useCallback(
    (id: string) => {
      setFocusables((prev) => prev.filter((f) => f.id !== id));
      if (currentFocusId === id) {
        setCurrentFocusId(null);
      }
    },
    [currentFocusId]
  );

  // 聚焦下一个元素
  const focusNext = useCallback(() => {
    if (focusables.length === 0) return;

    const currentIndex = currentFocusId
      ? focusables.findIndex((f) => f.id === currentFocusId)
      : -1;

    const nextIndex = (currentIndex + 1) % focusables.length;
    const nextElement = focusables[nextIndex];

    if (nextElement) {
      nextElement.focus();
      setCurrentFocusId(nextElement.id);
    }
  }, [focusables, currentFocusId]);

  // 聚焦上一个元素
  const focusPrev = useCallback(() => {
    if (focusables.length === 0) return;

    const currentIndex = currentFocusId
      ? focusables.findIndex((f) => f.id === currentFocusId)
      : -1;

    const prevIndex =
      (currentIndex - 1 + focusables.length) % focusables.length;
    const prevElement = focusables[prevIndex];

    if (prevElement) {
      prevElement.focus();
      setCurrentFocusId(prevElement.id);
    }
  }, [focusables, currentFocusId]);

  // 根据ID聚焦元素
  const focusById = useCallback(
    (id: string) => {
      const element = focusables.find((f) => f.id === id);
      if (element) {
        element.focus();
        setCurrentFocusId(id);
      }
    },
    [focusables]
  );

  // 初始化聚焦
  useEffect(() => {
    if (!initialized.current && focusables.length > 0) {
      const elementToFocus = initialFocusId
        ? focusables.find((f) => f.id === initialFocusId)
        : focusables[0];

      if (elementToFocus) {
        elementToFocus.focus();
        setCurrentFocusId(elementToFocus.id);
      }
      initialized.current = true;
    }
  }, [focusables, initialFocusId]);

  // 监听Tab键切换焦点
  useEffect(() => {
    const handleKeyDown = (key: string) => {
      if (key === 'tab') {
        focusNext();
      } else if (key === 'shift+tab') {
        focusPrev();
      }
    };

    // 在实际实现中，这里会监听键盘事件
    // 为了简化，我们省略具体的事件监听

    return () => {
      // 清理事件监听
    };
  }, [focusNext, focusPrev]);

  return {
    focusables,
    registerFocusable,
    unregisterFocusable,
    focusNext,
    focusPrev,
    focusById,
    currentFocusId,
  };
}

/**
 * 创建焦点管理器hook
 */
export function createUseFocusManager() {
  return useFocusManager;
}
