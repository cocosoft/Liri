// MIT License
// Copyright (c) 2026 190615273@qq.com

// P1-14: ContextWallet 单元测试
import { describe, it, expect } from 'bun:test';
import {
  generateContextSuggestions,
  formatWalletBreakdown,
} from '../../src/commands/builtin/context/ContextWallet';
import type { WalletBreakdown, WalletSuggestion } from '../../src/commands/builtin/context/ContextWallet';

describe('ContextWallet', () => {
  describe('generateContextSuggestions', () => {
    it('returns compact suggestion when tokens > 100K', () => {
      const suggestions: WalletSuggestion[] = [];
      generateContextSuggestions(
        {
          totalTokens: 150_000,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          models: [],
          totalRequests: 5,
        },
        suggestions
      );
      const hasNearLimit = suggestions.some((s) => s.type === 'near_limit');
      expect(hasNearLimit).toBe(true);
    });

    it('returns critical near_limit when tokens > 180K', () => {
      const suggestions: WalletSuggestion[] = [];
      generateContextSuggestions(
        {
          totalTokens: 200_000,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          models: [],
          totalRequests: 5,
        },
        suggestions
      );
      const criticalItem = suggestions.find((s) => s.type === 'near_limit');
      expect(criticalItem).toBeDefined();
      expect(criticalItem!.severity).toBe('critical');
    });

    it('suggests enable_cache when cache hit rate is low', () => {
      const suggestions: WalletSuggestion[] = [];
      generateContextSuggestions(
        {
          totalTokens: 50_000,
          cacheReadTokens: 0,
          cacheCreationTokens: 1000,
          models: [],
          totalRequests: 10,
        },
        suggestions
      );
      const hasCache = suggestions.some((s) => s.type === 'enable_cache');
      expect(hasCache).toBe(true);
    });

    it('suggests route_cheaper for expensive models', () => {
      const suggestions: WalletSuggestion[] = [];
      generateContextSuggestions(
        {
          totalTokens: 5_000,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          models: [
            {
              model: 'claude-opus',
              inputTokens: 10_000,
              outputTokens: 2_000,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              costUsd: 2.5,
              requests: 3,
            },
          ],
          totalRequests: 3,
        },
        suggestions
      );
      const hasRoute = suggestions.some((s) => s.type === 'route_cheaper');
      expect(hasRoute).toBe(true);
    });

    it('suggests trim_tools when many requests without cache', () => {
      const suggestions: WalletSuggestion[] = [];
      generateContextSuggestions(
        {
          totalTokens: 20_000,
          cacheReadTokens: 0,
          cacheCreationTokens: 1000,
          models: [],
          totalRequests: 30,
        },
        suggestions
      );
      const hasTrim = suggestions.some((s) => s.type === 'trim_tools');
      expect(hasTrim).toBe(true);
    });

    it('suggests proactive compact at 50K-100K tokens', () => {
      const suggestions: WalletSuggestion[] = [];
      generateContextSuggestions(
        {
          totalTokens: 75_000,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          models: [],
          totalRequests: 5,
        },
        suggestions
      );
      const hasCompact = suggestions.some((s) => s.type === 'compact');
      expect(hasCompact).toBe(true);
    });

    it('returns no suggestions for healthy context', () => {
      const suggestions: WalletSuggestion[] = [];
      generateContextSuggestions(
        {
          totalTokens: 5_000,
          cacheReadTokens: 8_000,
          cacheCreationTokens: 2_000,
          models: [],
          totalRequests: 3,
        },
        suggestions
      );
      expect(suggestions.length).toBe(0);
    });
  });

  describe('formatWalletBreakdown', () => {
    it('formats a complete breakdown', () => {
      const breakdown: WalletBreakdown = {
        sessionId: 'test-123',
        inputTokens: 10000,
        outputTokens: 5000,
        cacheReadTokens: 8000,
        cacheCreationTokens: 2000,
        reasoningTokens: 1000,
        totalTokens: 15000,
        estimatedCostUsd: 0.001,
        cacheSavingsUsd: 0.003,
        totalRequests: 5,
        sessionDurationSec: 120,
        models: [
          {
            model: 'claude-sonnet',
            inputTokens: 10000,
            outputTokens: 5000,
            cacheReadTokens: 8000,
            cacheCreationTokens: 2000,
            costUsd: 0.001,
            requests: 5,
          },
        ],
        suggestions: [
          {
            type: 'enable_cache',
            severity: 'info',
            message: '缓存命中率低',
            action: '使用 Anthropic 模型',
          },
        ],
      };

      const formatted = formatWalletBreakdown(breakdown);
      expect(formatted).toContain('上下文钱包');
      expect(formatted).toContain('test-123');
      expect(formatted).toContain('10,000');
      expect(formatted).toContain('$0.001000');
      expect(formatted).toContain('claude-sonnet');
      expect(formatted).toContain('缓存命中率低');
    });

    it('shows healthy message when no suggestions', () => {
      const breakdown: WalletBreakdown = {
        sessionId: 'test-456',
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        reasoningTokens: 0,
        totalTokens: 1500,
        estimatedCostUsd: 0,
        cacheSavingsUsd: 0,
        totalRequests: 1,
        sessionDurationSec: 30,
        models: [],
        suggestions: [],
      };

      const formatted = formatWalletBreakdown(breakdown);
      expect(formatted).toContain('上下文使用健康');
    });
  });
});
