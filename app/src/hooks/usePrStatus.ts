/**
 * PR状态Hook
 * * 用于获取和监控GitHub Pull Request状态
 */

import { useState, useEffect, useCallback, useRef } from 'react';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'hooks:usePrStatus',
  level: LogLevel.INFO,
});

/**
 * PR状态枚举
 */
export type PRStatus =
  | 'pending'
  | 'success'
  | 'failure'
  | 'error'
  | 'in_progress'
  | 'unknown';

/**
 * PR信息
 */
export interface PRInfo {
  number: number;
  title: string;
  author: string;
  state: 'open' | 'closed' | 'merged';
  status: PRStatus;
  createdAt: Date;
  updatedAt: Date;
  url: string;
  branch: string;
  targetBranch: string;
  checks?: PRCheck[];
  reviews?: PRReview[];
}

/**
 * PR检查状态
 */
export interface PRCheck {
  name: string;
  status: PRStatus;
  conclusion?: string;
  detailsUrl?: string;
  completedAt?: Date;
}

/**
 * PR评审信息
 */
export interface PRReview {
  author: string;
  state: 'approved' | 'changes_requested' | 'commented' | 'dismissed';
  submittedAt: Date;
}

/**
 * usePrStatus Hook结果
 */
export interface UsePrStatusResult {
  /** PR信息 */
  pr: PRInfo | null;
  /** 是否正在加载 */
  isLoading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 刷新PR状态 */
  refresh: () => void;
  /** 订阅PR状态变化 */
  subscribe: () => void;
  /** 取消订阅 */
  unsubscribe: () => void;
}

/**
 * usePrStatus Hook
 * @param repo GitHub仓库名称（格式: owner/repo）
 * @param prNumber PR编号
 * @returns PR状态信息和操作方法
 */
export function usePrStatus(repo: string, prNumber: number): UsePrStatusResult {
  const [pr, setPr] = useState<PRInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subscriptionRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPRStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const token = process.env.GITHUB_TOKEN || '';
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
      };
      if (token) {
        headers['Authorization'] = `token ${token}`;
      }

      const response = await fetch(
        `https://api.github.com/repos/${repo}/pulls/${prNumber}`,
        { headers }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      const checksResponse = await fetch(
        `https://api.github.com/repos/${repo}/commits/${data.head.sha}/check-runs`,
        { headers }
      );
      const checksData = checksResponse.ok
        ? await checksResponse.json()
        : { check_runs: [] };

      const reviewsResponse = await fetch(
        `https://api.github.com/repos/${repo}/pulls/${prNumber}/reviews`,
        { headers }
      );
      const reviewsData = reviewsResponse.ok
        ? await reviewsResponse.json()
        : [];

      const combinedStatusResponse = await fetch(
        `https://api.github.com/repos/${repo}/commits/${data.head.sha}/status`,
        { headers }
      );
      const combinedStatusData = combinedStatusResponse.ok
        ? await combinedStatusResponse.json()
        : { state: 'unknown' };

      const prInfo: PRInfo = {
        number: data.number,
        title: data.title,
        author: data.user.login,
        state: data.state as 'open' | 'closed' | 'merged',
        status: (combinedStatusData.state as PRStatus) || 'unknown',
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
        url: data.html_url,
        branch: data.head.ref,
        targetBranch: data.base.ref,
        checks:
          checksData.check_runs?.map((check: any) => ({
            name: check.name,
            status:
              check.status === 'completed'
                ? check.conclusion === 'success'
                  ? 'success'
                  : 'failure'
                : check.status === 'in_progress'
                  ? 'in_progress'
                  : 'pending',
            conclusion: check.conclusion,
            detailsUrl: check.html_url,
            completedAt: check.completed_at
              ? new Date(check.completed_at)
              : undefined,
          })) || [],
        reviews:
          reviewsData?.map((review: any) => ({
            author: review.user.login,
            state: review.state as
              | 'approved'
              | 'changes_requested'
              | 'commented'
              | 'dismissed',
            submittedAt: new Date(review.submitted_at),
          })) || [],
      };

      setPr(prInfo);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取PR状态失败');
    } finally {
      setIsLoading(false);
    }
  }, [repo, prNumber]);

  // 初始化加载
  useEffect(() => {
    fetchPRStatus();
  }, [fetchPRStatus]);

  // 刷新PR状态
  const refresh = useCallback(() => {
    fetchPRStatus();
  }, [fetchPRStatus]);

  // 订阅PR状态变化
  const subscribe = useCallback(() => {
    if (subscriptionRef.current) return;

    subscriptionRef.current = setInterval(() => {
      fetchPRStatus();
    }, 30000); // 每30秒刷新一次
  }, [fetchPRStatus]);

  // 取消订阅
  const unsubscribe = useCallback(() => {
    if (subscriptionRef.current) {
      clearInterval(subscriptionRef.current);
      subscriptionRef.current = null;
    }
  }, []);

  // 清理订阅
  useEffect(() => {
    return () => {
      unsubscribe();
    };
  }, [unsubscribe]);

  return {
    pr,
    isLoading,
    error,
    refresh,
    subscribe,
    unsubscribe,
  };
}

/**
 * 获取PR的综合状态
 */
export function getPRCombinedStatus(pr: PRInfo): PRStatus {
  // 检查检查状态
  if (pr.checks) {
    const failedCheck = pr.checks.find(
      (c) => c.status === 'failure' || c.status === 'error'
    );
    if (failedCheck) return failedCheck.status;

    const pendingCheck = pr.checks.find(
      (c) => c.status === 'pending' || c.status === 'in_progress'
    );
    if (pendingCheck) return pendingCheck.status;
  }

  // 检查评审状态
  if (pr.reviews) {
    const changesRequested = pr.reviews.find(
      (r) => r.state === 'changes_requested'
    );
    if (changesRequested) return 'failure';
  }

  return pr.status;
}

/**
 * 判断PR是否可以合并
 */
export function canMergePR(pr: PRInfo): boolean {
  const status = getPRCombinedStatus(pr);
  const hasApproval = pr.reviews?.some((r) => r.state === 'approved');

  return status === 'success' && !!hasApproval && pr.state === 'open';
}
