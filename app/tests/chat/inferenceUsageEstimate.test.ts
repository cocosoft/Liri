/**
 * 推理输入估算口径（X-06，2026-10-19）
 *
 * 回归点：诊断日志曾只估算 messages、漏掉 tools schema，导致
 * `estimated 4541 vs actual 13203`（191%）的假偏差。
 */
import { describe, expect, it } from 'bun:test';
import { estimateToolsTokens } from '../../src/chat/orchestrator/preSendContextProtection';
import { estimateMessagesTokens } from '../../src/ai/tokenizer/TokenEstimator';

describe('estimateToolsTokens', () => {
  it('空工具列表 ⇒ 0', () => {
    expect(estimateToolsTokens([])).toBe(0);
  });

  it('与发送前预算判定同口径（system 消息承载 tools JSON）', () => {
    const tools = [
      {
        name: 'file_read',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
        },
      },
      {
        name: 'bash',
        description: 'Run a shell command',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' } },
        },
      },
    ];
    const expected = estimateMessagesTokens([
      { role: 'system', content: JSON.stringify(tools) },
    ]);
    expect(estimateToolsTokens(tools)).toBe(expected);
    expect(estimateToolsTokens(tools)).toBeGreaterThan(0);
  });

  it('工具越多，占用越大（单调性）', () => {
    const small = [{ name: 'a', description: 'a' }];
    const large = [
      ...small,
      { name: 'b', description: 'b'.repeat(200) },
      { name: 'c', description: 'c'.repeat(200) },
    ];
    expect(estimateToolsTokens(large)).toBeGreaterThan(
      estimateToolsTokens(small)
    );
  });
});
