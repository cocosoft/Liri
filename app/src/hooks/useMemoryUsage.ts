/**
 * 内存使用量Hook
 * 提供进程内存使用情况的实时监控
 */

import { useState, useEffect, useCallback, useRef } from 'react';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('hooks:useMemoryUsage');

/**
 * 内存使用数据
 */
export interface MemoryUsageData {
  /** 堆内存使用量（字节） */
  heapUsed: number;
  /** 堆内存总量（字节） */
  heapTotal: number;
  /** RSS（字节） */
  rss: number;
  /** 外部内存（字节） */
  external: number;
  /** 堆使用率 */
  heapUsagePercent: number;
}

/**
 * useMemoryUsage Hook配置
 */
export interface UseMemoryUsageConfig {
  /** 轮询间隔（毫秒） */
  interval?: number;
  /** 是否在挂载时立即开始监控 */
  autoStart?: boolean;
}

/**
 * useMemoryUsage Hook返回结果
 */
export interface UseMemoryUsageResult {
  /** 内存使用数据 */
  memoryUsage: MemoryUsageData | null;
  /** 是否正在监控 */
  isMonitoring: boolean;
  /** 错误信息 */
  error: string | null;
  /** 开始监控 */
  start: () => void;
  /** 停止监控 */
  stop: () => void;
  /** 手动刷新 */
  refresh: () => void;
  /** 历史记录 */
  history: MemoryUsageData[];
}

/**
 * 获取当前内存使用量
 */
function getCurrentMemoryUsage(): MemoryUsageData {
  const usage = process.memoryUsage();
  return {
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    rss: usage.rss,
    external: usage.external || 0,
    heapUsagePercent:
      usage.heapTotal > 0 ? (usage.heapUsed / usage.heapTotal) * 100 : 0,
  };
}

/**
 * 内存使用量Hook
 */
export function useMemoryUsage(
  config: UseMemoryUsageConfig = {}
): UseMemoryUsageResult {
  const { interval = 5000, autoStart = true } = config;
  const [memoryUsage, setMemoryUsage] = useState<MemoryUsageData | null>(null);
  const [isMonitoring, setIsMonitoring] = useState(autoStart);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<MemoryUsageData[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    if (!mountedRef.current) return;
    try {
      const data = getCurrentMemoryUsage();
      setMemoryUsage(data);
      setHistory((prev) => {
        const next = [...prev, data];
        return next.length > 100 ? next.slice(-100) : next;
      });
      setError(null);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, []);

  const start = useCallback(() => {
    if (!mountedRef.current) return;
    setIsMonitoring(true);
  }, []);

  const stop = useCallback(() => {
    if (!mountedRef.current) return;
    setIsMonitoring(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if (autoStart) {
      refresh();
    }

    return () => {
      mountedRef.current = false;
    };
  }, [autoStart, refresh]);

  useEffect(() => {
    if (isMonitoring) {
      timerRef.current = setInterval(refresh, interval);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isMonitoring, interval, refresh]);

  return {
    memoryUsage,
    isMonitoring,
    error,
    start,
    stop,
    refresh,
    history,
  };
}
