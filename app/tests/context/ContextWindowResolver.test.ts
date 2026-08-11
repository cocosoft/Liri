// MIT License
// Copyright (c) 2026 190615273@qq.com

// P1-7: 上下文溢出渐进降级探测测试
import { describe, it, expect } from 'bun:test';
import {
  parseContextLimitFromError,
  parsePromptTokensFromError,
  isOutputCapError,
  getNextDegradationTier,
  validateMinimumContext,
  applyDegradationProbe,
  decideOverflowRecovery,
  resolveContextWindow,
} from '../../src/context/window/ContextWindowResolver';

describe('ContextWindowResolver — 上下文窗口解析', () => {
  describe('resolveContextWindow', () => {
    it('resolves 1M context model from name pattern', () => {
      const result = resolveContextWindow('gemini-2.0-flash');
      expect(result.tokens).toBe(1_000_000);
    });

    it('falls back to default for unknown model', () => {
      const result = resolveContextWindow('unknown-model-xyz');
      expect(result.tokens).toBe(200_000);
      expect(result.source).toBe('default');
    });

    it('sync path 不再维护模型名表：gpt-4o 回退默认 200K', () => {
      const result = resolveContextWindow('gpt-4o');
      expect(result.tokens).toBe(200_000);
      expect(result.source).toBe('default');
    });

    it('sync path 对 deepseek 系列同样回退默认（具体窗口由 DB async 路径提供）', () => {
      const result = resolveContextWindow('deepseek-v3');
      expect(result.tokens).toBe(200_000);
      expect(result.source).toBe('default');
    });

    it('respects config override', () => {
      const result = resolveContextWindow('gpt-4o', 256_000);
      expect(result.tokens).toBe(256_000);
      expect(result.source).toBe('config');
    });
  });
});

describe('P1-7: 渐进降级探测', () => {
  describe('parseContextLimitFromError', () => {
    it('extracts Anthropic max limit', () => {
      const result = parseContextLimitFromError(
        'Your request exceeds the maximum of 200000 tokens'
      );
      expect(result).toBe(200_000);
    });

    it('extracts OpenAI max limit', () => {
      const result = parseContextLimitFromError(
        'This model\'s maximum context length is 128000 tokens. Your request used 150000 tokens'
      );
      expect(result).toBe(128_000);
    });

    it('extracts llama.cpp exceeds available context size', () => {
      const result = parseContextLimitFromError(
        'request (15408 tokens) exceeds the available context size (4096 tokens), try increasing it'
      );
      expect(result).toBe(4096);
    });

    it('extracts llama.cpp bare exceeds available context size', () => {
      const result = parseContextLimitFromError(
        'request exceeds the available context size (4096 tokens)'
      );
      expect(result).toBe(4096);
    });

    it('returns -1 for generic overflow without exact number', () => {
      const result = parseContextLimitFromError(
        'context_length_exceeded: prompt is too long'
      );
      expect(result).toBe(-1);
    });

    it('returns -1 for prompt_too_long', () => {
      const result = parseContextLimitFromError(
        'prompt_too_long: maximum tokens exceeded'
      );
      expect(result).toBe(-1);
    });

    it('returns null for unrelated error', () => {
      const result = parseContextLimitFromError('API key is invalid');
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      const result = parseContextLimitFromError('');
      expect(result).toBeNull();
    });

    it('handles case-insensitive patterns', () => {
      const result = parseContextLimitFromError(
        'MAXIMUM CONTEXT LENGTH IS 64000'
      );
      expect(result).toBe(64_000);
    });
  });

  describe('parsePromptTokensFromError', () => {
    it('extracts llama.cpp n_prompt_tokens from overflow error', () => {
      const result = parsePromptTokensFromError(
        'request (15408 tokens) exceeds the available context size (4096 tokens), try increasing it'
      );
      expect(result).toBe(15_408);
    });

    it('handles comma-separated numbers', () => {
      const result = parsePromptTokensFromError(
        'request (154,208 tokens) exceeds the available context size'
      );
      expect(result).toBe(154_208);
    });

    it('returns null for unrelated error', () => {
      const result = parsePromptTokensFromError('API key is invalid');
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      const result = parsePromptTokensFromError('');
      expect(result).toBeNull();
    });
  });

  describe('isOutputCapError', () => {
    it('detects output cap error', () => {
      expect(isOutputCapError('output token limit exceeded')).toBe(true);
    });

    it('detects output too large', () => {
      expect(isOutputCapError('output is too long for this model')).toBe(true);
    });

    it('returns false for input context error', () => {
      expect(isOutputCapError('input context length exceeded')).toBe(false);
    });

    it('returns false for generic error', () => {
      expect(isOutputCapError('network timeout')).toBe(false);
    });
  });

  describe('getNextDegradationTier', () => {
    it('returns next lower tier from 256K', () => {
      expect(getNextDegradationTier(256_000)).toBe(128_000);
    });

    it('returns next lower tier from 128K', () => {
      expect(getNextDegradationTier(128_000)).toBe(64_000);
    });

    it('returns null at 64K (no lower tier >= MINIMUM 64K)', () => {
      expect(getNextDegradationTier(64_000)).toBeNull();
    });

    it('returns null when current tokens below MINIMUM', () => {
      expect(getNextDegradationTier(32_000)).toBeNull();
      expect(getNextDegradationTier(16_000)).toBeNull();
      expect(getNextDegradationTier(8_000)).toBeNull();
    });
  });

  describe('validateMinimumContext', () => {
    it('accepts tokens >= 64K', () => {
      expect(validateMinimumContext('test-model', 64_000)).toBe(true);
      expect(validateMinimumContext('test-model', 128_000)).toBe(true);
    });

    it('rejects tokens < 64K', () => {
      expect(validateMinimumContext('test-model', 32_000)).toBe(false);
      expect(validateMinimumContext('test-model', 8_000)).toBe(false);
    });
  });

  describe('applyDegradationProbe', () => {
    it('uses parsed API limit when available', () => {
      const result = applyDegradationProbe(
        'test-model',
        'maximum context length is 128000 tokens',
        256_000
      );
      expect(result.tokens).toBe(128_000);
      expect(result.degraded).toBe(true);
      expect(result.reason).toContain('128000');
    });

    it('uses probe tier when no API limit parsed', () => {
      const result = applyDegradationProbe(
        'test-model',
        'context_length_exceeded',
        256_000
      );
      expect(result.tokens).toBe(128_000);
      expect(result.degraded).toBe(true);
      expect(result.reason).toContain('Probe tier');
    });

    it('drops through all tiers', () => {
      const result = applyDegradationProbe(
        'test-model',
        'context_length_exceeded',
        8_000
      );
      expect(result.tokens).toBe(200_000);
      expect(result.degraded).toBe(true);
    });

    it('rejects API limit below MINIMUM', () => {
      const result = applyDegradationProbe(
        'test-model',
        'maximum of 32000 tokens',
        256_000
      );
      // 32000 < 64000 MINIMUM, so fall through to probe tier
      expect(result.tokens).toBe(128_000);
    });
  });

  describe('decideOverflowRecovery', () => {
    it('attempt 1: truncate 50%', () => {
      const decision = decideOverflowRecovery(1);
      expect(decision.action).toBe('truncate_head_and_retry');
      expect(decision.keepRatio).toBe(0.5);
    });

    it('attempt 2: strip images + 25%', () => {
      const decision = decideOverflowRecovery(2);
      expect(decision.action).toBe('strip_images_and_truncate');
      expect(decision.keepRatio).toBe(0.25);
    });

    it('attempt 3+: give up', () => {
      for (const n of [3, 4, 10]) {
        const decision = decideOverflowRecovery(n);
        expect(decision.action).toBe('give_up');
        expect(decision.keepRatio).toBe(0);
      }
    });
  });
});
