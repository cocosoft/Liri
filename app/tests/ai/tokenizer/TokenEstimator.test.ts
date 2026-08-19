// MIT License
// Copyright (c) 2026 190615273@qq.com

// P1-13: Token 估算单元测试 — o200k_base + CJK 启发式 + 精度基准
import { describe, it, expect } from 'bun:test';
import {
  estimateTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  estimateMessagesTokensCooperative,
  tokenCountWithEstimation,
  estimateTokensPrecise,
} from '../../../src/ai/tokenizer/TokenEstimator';

describe('TokenEstimator', () => {
  describe('estimateTokens', () => {
    it('returns 0 for empty text', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('estimates pure English text', () => {
      const tokens = estimateTokens('hello world this is a test');
      // ~5 words × 1.3 + 28 chars × 0.05 ≈ 7.9 → 8
      expect(tokens).toBeGreaterThan(5);
      expect(tokens).toBeLessThan(15);
    });

    it('estimates CJK text with higher ratio', () => {
      const tokens = estimateTokens('这是一段中文测试文本用于验证CJK估算精度');
      // 19 CJK chars × 1.5 + 0 non-CJK × 0.25 + words(≤5) ≈ 28.5 + 5 → 34
      expect(tokens).toBeGreaterThan(20);
      expect(tokens).toBeLessThan(45);
    });

    it('estimates mixed CJK+English', () => {
      // When CJK ≤30%, English formula applies: words×1.3 + chars×0.05
      const tokens = estimateTokens('这是CJK混合English测试text');
      // 6 CJK chars / 20 total = 0.3 (not >0.3) → English branch
      expect(tokens).toBeGreaterThanOrEqual(2);
      expect(tokens).toBeLessThan(10);
    });

    it('CJK ratio > 0.3 uses CJK formula', () => {
      // Mostly CJK
      const mostlyCJK = '今天是2026年7月29日天气晴朗';
      const cjkTokens = estimateTokens(mostlyCJK);
      // Mostly English
      const mostlyEng = 'hello world this is a long sentence in English';
      const engTokens = estimateTokens(mostlyEng);
      // CJK should cost more per char
      const cjkPerChar = cjkTokens / mostlyCJK.length;
      const engPerChar = engTokens / mostlyEng.length;
      expect(cjkPerChar).toBeGreaterThan(engPerChar);
    });

    it('pure numeric text uses chars/4', () => {
      const tokens = estimateTokens('12345678901234567890'); // 20 digits
      expect(tokens).toBe(5); // 20/4 = 5
    });
  });

  describe('estimateMessageTokens', () => {
    it('includes role overhead', () => {
      const tokens = estimateMessageTokens({ role: 'system', content: 'hello' });
      // content: "hello" → 5 chars/4 → 2, plus system overhead 4 = 6
      expect(tokens).toBeGreaterThanOrEqual(5);
    });

    it('handles non-string content', () => {
      const tokens = estimateMessageTokens({ role: 'user', content: { key: 'value' } });
      // JSON.stringify({key:'value'}) = '{"key":"value"}' → 16 chars → 4 tokens + 5 overhead = 9
      expect(tokens).toBeGreaterThan(4);
    });

    it('defaults role to user overhead', () => {
      const tokens = estimateMessageTokens({ content: 'test' });
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('estimateMessagesTokens', () => {
    it('returns 0 for empty array', () => {
      expect(estimateMessagesTokens([])).toBe(0);
    });

    it('sums multiple messages', () => {
      const tokens = estimateMessagesTokens([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ]);
      expect(tokens).toBeGreaterThan(5);
    });
  });

  describe('estimateMessagesTokensCooperative', () => {
    it('returns 0 for empty array', async () => {
      expect(await estimateMessagesTokensCooperative([])).toBe(0);
    });

    it('matches sync estimateMessagesTokens result (口径一致)', async () => {
      const messages = [
        { role: 'user', content: 'hello world 这是一段中文测试' },
        { role: 'assistant', content: 'hi there, 继续处理' },
        { role: 'tool', content: '{"status":"ok","data":123}' },
        { role: 'user', content: 'over 25 messages to force multiple batches' },
      ];
      const syncResult = estimateMessagesTokens(messages);
      const coopResult = await estimateMessagesTokensCooperative(messages);
      expect(coopResult).toBe(syncResult);
    });

    it('handles large lists across multiple batches', async () => {
      const messages = Array.from({ length: 60 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as string,
        content: `消息内容 ${i} — 中文 mixed english`,
      }));
      const syncResult = estimateMessagesTokens(messages);
      const coopResult = await estimateMessagesTokensCooperative(messages);
      expect(coopResult).toBe(syncResult);
    });
  });

  describe('tokenCountWithEstimation', () => {
    it('uses apiReportedTokens when available', () => {
      const result = tokenCountWithEstimation([], 12345);
      expect(result).toBe(12345);
    });

    it('uses message usage when available', () => {
      const result = tokenCountWithEstimation([
        { role: 'assistant', content: 'ok', usage: { totalTokens: 999 } },
      ], null);
      expect(result).toBe(999);
    });

    it('falls back to estimate when no usage data', () => {
      const result = tokenCountWithEstimation([
        { role: 'user', content: 'hello world' },
      ], null);
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('estimateTokensPrecise', () => {
    it('returns estimate when tiktoken unavailable', async () => {
      // tiktoken may or may not be cached — test that it returns a number either way
      const tokens = await estimateTokensPrecise('test text');
      expect(tokens).toBeGreaterThan(0);
      expect(typeof tokens).toBe('number');
    });
  });
});
