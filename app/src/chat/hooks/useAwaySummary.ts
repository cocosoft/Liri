/**
 * 离开摘要钩子
 * 当终端失焦一段时间后自动生成摘要
 * 参考CC源码 hooks/useAwaySummary.ts 实现
 */

import { useEffect, useRef, useCallback } from 'react';
import type { Message } from '../types/message.js';
import {
  AwaySummaryService,
  hasSummarySinceLastUserTurn,
  type AwaySummaryConfig,
} from '../services/AwaySummaryService.js';

export interface UseAwaySummaryOptions {
  /** 离开摘要配置 */
  config?: Partial<AwaySummaryConfig>;
  /** 消息更新回调 */
  onSummaryGenerated?: (summary: string) => void;
}

export interface UseAwaySummaryReturn {
  /** 服务实例 */
  service: AwaySummaryService;
  /** 手动触发摘要生成 */
  generateSummary: () => Promise<void>;
  /** 是否正在生成 */
  isGenerating: boolean;
}

/**
 * 离开摘要钩子
 * 当用户离开5分钟后自动生成摘要
 */
export function useAwaySummary(
  messages: readonly Message[],
  isLoading: boolean,
  options: UseAwaySummaryOptions = {}
): UseAwaySummaryReturn {
  const serviceRef = useRef<AwaySummaryService | null>(null);
  const pendingRef = useRef(false);
  const generateRef = useRef<(() => Promise<void>) | null>(null);
  const isGeneratingRef = useRef(false);

  if (!serviceRef.current) {
    serviceRef.current = new AwaySummaryService(options.config);
  }

  const service = serviceRef.current;

  const generateSummary = useCallback(async () => {
    if (!serviceRef.current) return;
    if (hasSummarySinceLastUserTurn(messages)) return;
    if (isGeneratingRef.current) return;

    isGeneratingRef.current = true;

    try {
      const result = await serviceRef.current.generateSummary([...messages]);
      if (result && options.onSummaryGenerated) {
        options.onSummaryGenerated(result.summary);
      }
    } catch {
      // @ignore-catch: 摘要生成失败由 finally 复位生成标志（前端 hook 无日志设施、
      // no-console 约束，失败不应产生 unhandled rejection）；onSummaryGenerated 由调用方决定是否提示
    } finally {
      isGeneratingRef.current = false;
    }
  }, [messages, options.onSummaryGenerated]);

  generateRef.current = generateSummary;

  useEffect(() => {
    return () => {
      service.destroy();
    };
  }, [service]);

  useEffect(() => {
    if (!service.config.enabled) return;

    function onBlurTimerFire(): void {
      if (isLoading) {
        pendingRef.current = true;
        return;
      }
      void generateRef.current?.();
    }

    function onFocusChange(state: 'focused' | 'blurred' | 'unknown'): void {
      service.handleFocusChange(state);

      if (state === 'blurred') {
        // 计时器已在 handleFocusChange 中启动
      } else if (state === 'focused') {
        pendingRef.current = false;
      }
    }

    // 模拟焦点监听
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        onFocusChange('blurred');
      } else {
        onFocusChange('focused');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [service]);

  useEffect(() => {
    if (isLoading) return;
    if (!pendingRef.current) return;

    pendingRef.current = false;
    void generateRef.current?.();
  }, [isLoading]);

  return {
    service,
    generateSummary,
    isGenerating: isGeneratingRef.current,
  };
}
