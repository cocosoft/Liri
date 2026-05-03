/**
 * 差异数据Hook
 * 提供Git差异数据的获取和状态管理
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getDiff } from '../commands/builtin/diff/Diff.js';
import type { DiffResult } from '../commands/builtin/diff/Diff.js';

/**
 * useDiffData Hook配置
 */
export interface UseDiffDataConfig {
  /** 是否仅暂存区 */
  stagedOnly?: boolean;
  /** 工作目录 */
  cwd?: string;
  /** 自动刷新间隔（毫秒），0表示不自动刷新 */
  refreshInterval?: number;
}

/**
 * useDiffData Hook返回结果
 */
export interface UseDiffDataResult {
  /** 差异数据 */
  diff: DiffResult | null;
  /** 是否正在加载 */
  isLoading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 刷新差异数据 */
  refresh: () => Promise<void>;
  /** 是否有变更 */
  hasChanges: boolean;
}

/**
 * 差异数据Hook
 */
export function useDiffData(config: UseDiffDataConfig = {}): UseDiffDataResult {
  const { stagedOnly = false, cwd, refreshInterval = 0 } = config;
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const fetchDiff = useCallback(async () => {
    if (!mountedRef.current) return;
    setIsLoading(true);
    setError(null);

    try {
      const result = await getDiff(stagedOnly, cwd);
      if (mountedRef.current) {
        setDiff(result);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [stagedOnly, cwd]);

  useEffect(() => {
    mountedRef.current = true;

    if (refreshInterval > 0) {
      timerRef.current = setInterval(fetchDiff, refreshInterval);
    }

    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [fetchDiff, refreshInterval]);

  return {
    diff,
    isLoading,
    error,
    refresh: fetchDiff,
    hasChanges: diff !== null && (diff.files.length > 0 || diff.additions > 0 || diff.deletions > 0),
  };
}
