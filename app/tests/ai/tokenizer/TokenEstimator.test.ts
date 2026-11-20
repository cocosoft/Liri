// MIT License
// Copyright (c) 2026 190615273@qq.com

// P1-13: Token 估算单元测试 — o200k_base + CJK 启发式 + 精度基准
import { describe, it, expect } from 'bun:test';
import {
  estimateTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  estimateMessagesTokensCooperative,
  estimateMessagesTokensCooperativeFromTail,
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
      const tokens = estimateMessageTokens({
        role: 'system',
        content: 'hello',
      });
      // content: "hello" → 5 chars/4 → 2, plus system overhead 4 = 6
      expect(tokens).toBeGreaterThanOrEqual(5);
    });

    it('handles non-string content', () => {
      const tokens = estimateMessageTokens({
        role: 'user',
        content: { key: 'value' },
      });
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

    it('R3: 同对象重复估算结果一致（命中按对象身份缓存，增量复用）', () => {
      const messages = [
        { role: 'system', content: '你是助手' },
        { role: 'user', content: '帮我分析这份文档' },
        { role: 'assistant', content: '好的，我先读取文件' },
      ];
      const first = estimateMessagesTokens(messages);
      // 再次用同一批消息对象估算 → tiktoken cache 命中，结果一致
      expect(estimateMessagesTokens(messages)).toBe(first);
      expect(estimateMessagesTokens(messages)).toBe(first);
    });

    it('R3: 追加新消息只使总量增加，历史对象估算仍命中', () => {
      const history = [{ role: 'user', content: '第一轮提问内容较长一些' }];
      const base = estimateMessagesTokens(history);
      const next = estimateMessagesTokens([
        ...history,
        { role: 'assistant', content: '第二轮回答内容' },
      ]);
      // 追加一条消息 → 总量应严格大于仅历史段
      expect(next).toBeGreaterThan(base);
    });

    /**
     * 2026-11-20（函数级 CPU profile）：超长正文**不得**再走 js-tiktoken BPE。
     *
     * 实测 BPE 对无分隔长 CJK 是超线性（8000 字 ≈26.8s），真机曾因此在单测里阻塞 155.9s。
     * 断言口径：超长正文的内容 tokens 必须**恰好等于** `estimateTokens()`（启发式）；
     * 若走了 BPE（纯 CJK ≈1 token/字）则会得到 ≈8000，与启发式（≈1.5/字）明显不等。
     */
    it('超长正文（>2000 字符）走 CJK 启发式而非 BPE', () => {
      const body = '你'.repeat(8000);
      const emptyMsg = [{ role: 'user', content: '' }];
      const longMsg = [{ role: 'user', content: body }];
      const delta =
        estimateMessagesTokens(longMsg) - estimateMessagesTokens(emptyMsg);
      expect(delta).toBe(estimateTokens(body));
      expect(delta).toBeGreaterThan(body.length); // 启发式 >1/字，BPE 才会 ≈1/字
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

  /**
   * G2 D4（2026-11-18）：**估算器契约** —— 三条实现必须同源可证：
   * ① 同输入同结果（全量同步 vs 尾部协作，未触 cap）；
   * ② 触 cap 时是**下界**（`capped:true` 且 `cap ≤ tokens ≤ 全量`），不得被当成等值；
   * ③ 空输入恒 0。
   */
  describe('估算器契约：同源与下界语义（G2 D4）', () => {
    const sample = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as string,
      content: `第 ${i} 条：上下文口径统一 testing token accounting ${'x'.repeat(i * 20)}`,
    }));

    it('未触 cap ⇒ 尾部估算与全量同步估算**逐值相等**', async () => {
      const full = estimateMessagesTokens(sample);
      const tail = await estimateMessagesTokensCooperativeFromTail(
        sample,
        Number.MAX_SAFE_INTEGER
      );
      expect(tail.capped).toBe(false);
      expect(tail.tokens).toBe(full);
    });

    it('触 cap ⇒ capped=true 且 tokens 落在 [cap, 全量] 区间（下界语义）', async () => {
      const full = estimateMessagesTokens(sample);
      const cap = Math.max(1, Math.floor(full / 3));
      const tail = await estimateMessagesTokensCooperativeFromTail(sample, cap);
      expect(tail.capped).toBe(true);
      expect(tail.tokens).toBeGreaterThanOrEqual(cap);
      expect(tail.tokens).toBeLessThanOrEqual(full);
    });

    it('空输入 ⇒ 0 / capped=false（不臆造）', async () => {
      expect(await estimateMessagesTokensCooperativeFromTail([], 100)).toEqual({
        tokens: 0,
        capped: false,
      });
    });
  });

  describe('tokenCountWithEstimation', () => {
    it('uses apiReportedTokens when available', () => {
      const result = tokenCountWithEstimation([], 12345);
      expect(result).toBe(12345);
    });

    it('uses message usage when available', () => {
      const result = tokenCountWithEstimation(
        [{ role: 'assistant', content: 'ok', usage: { totalTokens: 999 } }],
        null
      );
      expect(result).toBe(999);
    });

    it('falls back to estimate when no usage data', () => {
      const result = tokenCountWithEstimation(
        [{ role: 'user', content: 'hello world' }],
        null
      );
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
