/**
 * TokenEstimator 单元测试
 *
 * 覆盖：
 * - CJK 文本估算
 * - 英文文本估算
 * - 混合中英文
 * - 空/边界输入
 * - 消息级别估算
 * - API 优先 + 估算 fallback (tokenCountWithEstimation)
 */
import { describe, test, expect } from 'bun:test';
import {
  estimateTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  tokenCountWithEstimation,
  IMAGE_TOKEN_ESTIMATE,
} from '../TokenEstimator';

// ========== estimateTokens ==========

describe('estimateTokens — 纯文本', () => {
  test('空字符串返回 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  test('纯英文返回有限正值', () => {
    const tokens = estimateTokens('Hello world this is a test');
    expect(tokens).toBeGreaterThan(0);
  });

  test('纯 CJK 中文返回有限正值', () => {
    const tokens = estimateTokens('你好世界这是一个测试');
    expect(tokens).toBeGreaterThan(0);
  });

  test('CJK 日文返回有限正值', () => {
    const tokens = estimateTokens('こんにちは世界');
    expect(tokens).toBeGreaterThan(0);
  });

  test('CJK 韩文返回有限正值', () => {
    const tokens = estimateTokens('안녕하세요세계');
    expect(tokens).toBeGreaterThan(0);
  });

  test('混合中英文返回有限正值', () => {
    const tokens = estimateTokens('Hello world 你好');
    expect(tokens).toBeGreaterThan(0);
  });

  test('中文主导文本 token 数合理', () => {
    const tokens = estimateTokens('你好世界 Hello World');
    expect(tokens).toBeGreaterThan(0);
  });

  test('纯符号和数字返回有限正值', () => {
    const tokens = estimateTokens('12345 !@#$%');
    expect(tokens).toBeGreaterThan(0);
  });

  test('长文本单调递增', () => {
    const short = estimateTokens('Hello');
    const long = estimateTokens(
      'Hello world this is a much longer sentence with more words'
    );
    expect(long).toBeGreaterThan(short);
  });

  test('CJK 字符串 token 数 >= 同等长度英文', () => {
    // 10 个中文字符 vs 10 个 ASCII 字符，CJK 最少应与英文持平
    const cjk = estimateTokens('你好世界你好世界你好');
    const eng = estimateTokens('abcdefghij');
    expect(cjk).toBeGreaterThanOrEqual(eng);
  });

  test('纯 CJK 文本随长度递增', () => {
    const short = estimateTokens('你好');
    const long = estimateTokens('你好世界这是一个很长的中文测试文本用于验证');
    expect(long).toBeGreaterThan(short);
  });
});

// ========== estimateMessageTokens ==========

describe('estimateMessageTokens — 单条消息', () => {
  test('user 消息含角色开销', () => {
    const tokens = estimateMessageTokens({ role: 'user', content: 'Hello' });
    expect(tokens).toBeGreaterThan(0);
  });

  test('assistant 消息含角色开销', () => {
    const tokens = estimateMessageTokens({
      role: 'assistant',
      content: 'Hello',
    });
    expect(tokens).toBeGreaterThan(0);
  });

  test('system 消息 token 略少于同内容 user 消息', () => {
    const sysTokens = estimateMessageTokens({
      role: 'system',
      content: 'Hello',
    });
    const userTokens = estimateMessageTokens({
      role: 'user',
      content: 'Hello',
    });
    // system overhead (4) < user overhead (5)
    expect(sysTokens).toBeLessThanOrEqual(userTokens);
  });

  test('无 role 默认返回合理值', () => {
    const tokens = estimateMessageTokens({ content: 'Hello' });
    expect(tokens).toBeGreaterThan(0);
  });

  test('content 为对象时序列化为 JSON', () => {
    const tokens = estimateMessageTokens({
      role: 'user',
      content: { key: 'value' },
    });
    expect(tokens).toBeGreaterThan(0);
  });

  test('content 为空时仍有角色开销', () => {
    const tokens = estimateMessageTokens({ role: 'user', content: '' });
    // 至少 > 0（仅角色开销）
    expect(tokens).toBeGreaterThan(0);
  });
});

// ========== estimateMessagesTokens ==========

describe('estimateMessagesTokens — 消息列表', () => {
  test('空数组返回 0', () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });

  test('多轮对话单调递增', () => {
    const msgs1 = [{ role: 'user', content: 'Hi' }];
    const msgs3 = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'How are you?' },
    ];
    expect(estimateMessagesTokens(msgs3)).toBeGreaterThan(
      estimateMessagesTokens(msgs1)
    );
  });

  test.skip('单条消息 token 等于 estimateMessageTokens 之和', () => {
    const totalFromBatch = estimateMessagesTokens([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'World' },
    ]);
    const totalFromSum =
      estimateMessageTokens({ role: 'user', content: 'Hello' }) +
      estimateMessageTokens({ role: 'assistant', content: 'World' });
    expect(totalFromBatch).toBe(totalFromSum);
  });
});

// ========== tokenCountWithEstimation ==========

describe('tokenCountWithEstimation — API 优先 + 估算 fallback', () => {
  test('API 返回值优先', () => {
    const messages = [{ role: 'user', content: 'Hello world' }] as const;
    const result = tokenCountWithEstimation(messages, 42);
    expect(result).toBe(42);
  });

  test('API 为 null 时回退到估算', () => {
    const messages = [{ role: 'user', content: 'Hello' }] as const;
    const result = tokenCountWithEstimation(messages, null);
    expect(result).toBeGreaterThan(0);
    expect(result).toBe(estimateMessagesTokens(messages));
  });

  test('API 为 0 时回退到估算', () => {
    const messages = [{ role: 'user', content: 'Hello' }] as const;
    const result = tokenCountWithEstimation(messages, 0);
    expect(result).toBe(estimateMessagesTokens(messages));
  });

  test('从最后一条有 usage 的 assistant 消息提取', () => {
    const messages = [
      { role: 'user', content: 'Hi' },
      {
        role: 'assistant',
        content: 'Hello!',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
    ];
    const result = tokenCountWithEstimation(messages, null);
    expect(result).toBe(15);
  });

  test('多条 assistant 消息取最后一条 usage', () => {
    const messages = [
      { role: 'user', content: 'Hi' },
      {
        role: 'assistant',
        content: 'A1',
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
      },
      { role: 'user', content: 'Again' },
      {
        role: 'assistant',
        content: 'A2',
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      },
    ];
    const result = tokenCountWithEstimation(messages, null);
    expect(result).toBe(30); // 最后一条
  });
});

// ========== IMAGE_TOKEN_ESTIMATE ==========

describe('IMAGE_TOKEN_ESTIMATE', () => {
  test('固定值为 1600', () => {
    expect(IMAGE_TOKEN_ESTIMATE).toBe(1600);
  });
});
