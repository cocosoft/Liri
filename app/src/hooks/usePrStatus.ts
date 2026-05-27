/**
 * PR状态Hook
 * * 用于获取和监控GitHub Pull Request状态
 */

import { useState, useEffect, useCallback, useRef } from 'react';

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
 * 模拟PR API响应（实际应用中应调用GitHub API）
 */
const mockPRData: PRInfo = {
  number: 123,
  title: 'feat: 添加语音输入功能',
  author: 'developer',
  state: 'open',
  status: 'success',
  createdAt: new Date('2026-04-28'),
  updatedAt: new Date('2026-04-30'),
  url: 'https://github.com/example/repo/pull/123',
  branch: 'feature/voice-input',
  targetBranch: 'main',
  checks: [
    {
      name: 'CI/CD',
      status: 'success',
      conclusion: 'success',
      completedAt: new Date(),
    },
    {
      name: 'Lint',
      status: 'success',
      conclusion: 'success',
      completedAt: new Date(),
    },
    {
      name: 'Tests',
      status: 'success',
      conclusion: 'success',
      completedAt: new Date(),
    },
  ],
  reviews: [
    { author: 'reviewer1', state: 'approved', submittedAt: new Date() },
  ],
};

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

  // 获取PR状态
  const fetchPRStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // 实际应用中应调用GitHub API
      // const response = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`);
      // const data = await response.json();

      // 模拟API响应
      await new Promise((resolve) => setTimeout(resolve, 500));
      setPr({ ...mockPRData, number: prNumber });
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

  return status === 'success' && hasApproval && pr.state === 'open';
}
