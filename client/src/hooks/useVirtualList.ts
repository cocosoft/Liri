import { useRef, useState, useMemo, useCallback, useEffect } from 'react';

interface UseVirtualListOptions {
  itemHeight?: number;
  overscan?: number;
}

interface UseVirtualListResult<T> {
  containerRef: (el: HTMLDivElement | null) => void;
  visibleItems: T[];
  totalHeight: number;
  offsetY: number;
  measureItem: (index: number, height: number) => void;
}

const DEFAULT_ITEM_HEIGHT = 80;

export function useVirtualList<T>(
  items: T[],
  options: UseVirtualListOptions = {}
): UseVirtualListResult<T> {
  const { itemHeight = DEFAULT_ITEM_HEIGHT, overscan = 5 } = options;
  const containerRefInternal = useRef<HTMLDivElement | null>(null);
  const heightsRef = useRef<Map<number, number>>(new Map());
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const rafRef = useRef<number>(0);
  const prevItemsLengthRef = useRef(0);

  const containerRef = useCallback((el: HTMLDivElement | null) => {
    containerRefInternal.current = el;
  }, []);

  useEffect(() => {
    const container = containerRefInternal.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(container);

    const handleScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setScrollTop(container.scrollTop);
      });
    };
    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      container.removeEventListener('scroll', handleScroll);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    const container = containerRefInternal.current;
    if (!container) return;

    const prevLen = prevItemsLengthRef.current;
    if (items.length > prevLen) {
      const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      if (isAtBottom) {
        queueMicrotask(() => {
          container.scrollTop = container.scrollHeight;
        });
      }
    }
    prevItemsLengthRef.current = items.length;
  }, [items.length]);

  const { totalHeight, startIndex, endIndex } = useMemo(() => {
    const heights = heightsRef.current;
    let total = 0;
    const cumulative: number[] = [];

    for (let i = 0; i < items.length; i++) {
      const h = heights.get(i) ?? itemHeight;
      total += h;
      cumulative.push(total);
    }

    const findIdx = (value: number): number => {
      let lo = 0;
      let hi = cumulative.length - 1;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (cumulative[mid] <= value) {
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return lo;
    };

    const start = Math.max(0, findIdx(scrollTop) - overscan);
    const end = Math.min(items.length, findIdx(scrollTop + containerHeight) + overscan);

    return { totalHeight: total, startIndex: start, endIndex: end };
  }, [items, scrollTop, containerHeight, itemHeight, overscan]);

  const measureItem = useCallback((index: number, height: number) => {
    if (height > 0) {
      heightsRef.current.set(index, height);
    }
  }, []);

  const visibleItems = useMemo(
    () => items.slice(startIndex, endIndex),
    [items, startIndex, endIndex]
  );

  const offsetY = useMemo(() => {
    let offset = 0;
    for (let i = 0; i < startIndex; i++) {
      offset += heightsRef.current.get(i) ?? itemHeight;
    }
    return offset;
  }, [startIndex, itemHeight]);

  return {
    containerRef,
    visibleItems,
    totalHeight,
    offsetY,
    measureItem,
  };
}
