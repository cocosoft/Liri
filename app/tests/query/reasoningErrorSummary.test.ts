/**
 * 推理错误可读摘要（P1-3，2026-11-06）
 *
 * 钉住「助手正文不再是 provider 协议原文」：分类后给可操作文案；无法归类才回退首行。
 * 真实样本取自台账 §29：`AppError: OpenAI API error (400): {"error":{"message":
 * "Messages with role 'tool' must be a response to a preceding message with 'tool_calls'"}}`
 */
import { describe, expect, it } from 'bun:test';
import { summarizeReasoningError } from '../../src/query/reasoningErrorSummary';

describe('summarizeReasoningError', () => {
  it('工具/结果配对破坏 ⇒ 协议类文案（不含原始 JSON）', () => {
    const raw =
      'AppError: OpenAI API error (400): {"error":{"message":"Messages with role \'tool\' must be a response to a preceding message with \'tool_calls\'"}}';
    const text = summarizeReasoningError(new Error(raw));
    expect(text).toContain('消息序列不符合模型协议');
    expect(text).not.toContain('{"error"');
  });

  it('401/403 ⇒ 鉴权文案', () => {
    expect(
      summarizeReasoningError(new Error('OpenAI API error (401): Unauthorized'))
    ).toContain('鉴权失败');
    expect(summarizeReasoningError(new Error('HTTP 403: forbidden'))).toContain(
      '鉴权失败'
    );
  });

  it('429 ⇒ 限流文案', () => {
    expect(
      summarizeReasoningError(new Error('OpenAI API error (429): rate limit'))
    ).toContain('限流');
  });

  it('5xx ⇒ 服务不可用文案', () => {
    expect(
      summarizeReasoningError(new Error('OpenAI API error (503): busy'))
    ).toContain('暂时不可用');
  });

  it('上下文超窗 / 网络异常分别给对应出路', () => {
    expect(
      summarizeReasoningError(
        new Error("This model's maximum context length is 128000 tokens")
      )
    ).toContain('上下文');
    expect(
      summarizeReasoningError(new Error('fetch failed: ETIMEDOUT'))
    ).toContain('网络');
  });

  it('无法归类 ⇒ 回退首行（截断），空错误给通用文案', () => {
    expect(summarizeReasoningError(new Error('weird provider blowup'))).toBe(
      '本轮推理失败：weird provider blowup'
    );
    expect(summarizeReasoningError('')).toContain('本轮推理失败');
  });
});
