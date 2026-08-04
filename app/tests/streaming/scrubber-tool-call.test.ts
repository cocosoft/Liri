// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 测试 StreamingToolCallScrubber 的标签误判修复
 *
 * 验证正文中出现工具调用标签时不会被误擦除。
 */
import { describe, it, expect } from 'bun:test';
import { StreamingToolCallScrubber } from '../../src/streaming/scrubbers/StreamingToolCallScrubber.js';

function scrubText(text: string): string {
  const scrubber = new StreamingToolCallScrubber();
  const result = scrubber.scrub({ content: text, isComplete: true });
  const flushed = scrubber.flush();
  return (result.content ?? '') + flushed;
}

describe('StreamingToolCallScrubber — 正文标签误判修复', () => {
  // ─── 真实工具调用（应擦除）──────────────────

  it('真实 Hermes tool_call 应被擦除', () => {
    const raw = '<tool_call>{"name":"search","arguments":{"query":"test"}}</tool_call>';
    const result = scrubText(raw);
    // tool_call 不含 name=，提示为通用文本
    expect(result).toContain('[调用工具');
    expect(result).not.toContain('search');
    expect(result).not.toContain('tool_call');
  });

  it('真实 GLM tool_call 应被擦除', () => {
    const raw = '<tool_call>search\n<arg_key>query</arg_key><arg_value>test</arg_value>\n</tool_call>';
    const result = scrubText(raw);
    expect(result).toContain('[调用工具');
    expect(result).not.toContain('search');
    expect(result).not.toContain('tool_call');
  });

  it('真实 invoke（含 name=）应被擦除', () => {
    const raw = '<invoke name="glob"><parameter name="pattern">*.ts</parameter></invoke>';
    const result = scrubText(raw);
    // invoke 含 name=，提示包含工具名
    expect(result).toContain('[调用工具: glob');
    expect(result).not.toContain('*.ts');
  });

  it('真实 tool_calls 包装应被擦除', () => {
    const raw =
      '<tool_calls><tool_call>{"name":"read","arguments":{"path":"/tmp"}}</tool_call></tool_calls>';
    const result = scrubText(raw);
    // 嵌套: 外层 <tool_calls> 不含 name=，提示为通用
    expect(result).toContain('[调用工具');
    expect(result).not.toContain('/tmp');
    expect(result).not.toContain('tool_calls');
    expect(result).not.toContain('tool_call');
  });

  // ─── 正文中的标签（不应擦除）──────────────────

  it('正文中的 <tool_call> 后跟函数名但无 arg_key → 不擦除', () => {
    const raw = '格式说明：<tool_call>function_name 是旧版写法';
    const result = scrubText(raw);
    expect(result).toContain('<tool_call>function_name');
    expect(result).toContain('旧版写法');
  });

  it('裸 invoke（无 name=）→ 不擦除', () => {
    const raw = '系统使用 <invoke> 标签来触发工具';
    const result = scrubText(raw);
    expect(result).toContain('<invoke>');
    expect(result).toContain('触发工具');
  });

  it('正文中的 tool_call 后跟 JSON 示例 — 结构上无法区分，仍擦除', () => {
    // 正文中 <tool_call>{"name":"x"}...</tool_call> 与真实工具调用结构一致
    // 这是可接受的权衡：真假难分时宁可擦除（不暴露原始标签）
    const raw = '格式：<tool_call>{"name":"x"}</tool_call> 就是这样';
    const result = scrubText(raw);
    expect(result).toContain('格式：');
    expect(result).not.toContain('{"name"');
  });

  it('正文中的 tool_call 后跟普通文本 → 不擦除', () => {
    const raw = '标签格式是 <tool_call> 后面跟 JSON 内容';
    const result = scrubText(raw);
    expect(result).toContain('<tool_call>');
    expect(result).toContain('JSON 内容');
  });

  it('真实工具调用在正文中 — 前导文本保留', () => {
    const raw = '我来帮你搜索：<tool_call>{"name":"search","arguments":{"q":"hello"}}</tool_call>';
    const result = scrubText(raw);
    expect(result).toContain('我来帮你搜索：');
    expect(result).toContain('[调用工具');
    expect(result).not.toContain('search');
  });

  // ─── 边界条件 ──────────────────

  it('空内容不崩', () => {
    const scrubber = new StreamingToolCallScrubber();
    const result = scrubber.scrub({ content: '', isComplete: true });
    expect(result.content).toBe('');
  });

  it('自闭合标签直接跳过', () => {
    const raw = 'before <tool_call/> after';
    const result = scrubText(raw);
    expect(result).toBe('before  after');
  });

  it('多 chunk 跨边界 — pending 后验证通过', () => {
    const scrubber = new StreamingToolCallScrubber();
    // chunk 1: 标签在末尾，无后续内容
    const r1 = scrubber.scrub({ content: '<tool_call>', isComplete: false });
    // chunk 2: JSON 内容到达
    const r2 = scrubber.scrub({
      content: '{"name":"f","arguments":{}}</tool_call>',
      isComplete: true,
    });
    const flushed = scrubber.flush();
    const result = (r1.content ?? '') + (r2.content ?? '') + flushed;
    expect(result).toContain('[调用工具');
    expect(result).not.toContain('{"name"');
  });

  it('多 chunk 跨边界 — pending 后验证不通过', () => {
    const scrubber = new StreamingToolCallScrubber();
    // chunk 1: 标签在末尾
    const r1 = scrubber.scrub({ content: '<tool_call>', isComplete: false });
    // chunk 2: 后续为普通文本（非 JSON，非 GLM）
    const r2 = scrubber.scrub({ content: '普通文本继续', isComplete: true });
    const flushed = scrubber.flush();
    const result = (r1.content ?? '') + (r2.content ?? '') + flushed;
    expect(result).toContain('<tool_call>普通文本继续');
    expect(result).not.toContain('[调用工具');
  });

  // ─── invoke 含属性但无 name= → 不擦除 ──────

  it('invoke 含其他属性但无 name= → 不擦除', () => {
    const raw = 'XML 示例：<invoke id="123">content</invoke> 结束';
    const result = scrubText(raw);
    expect(result).toContain('<invoke id="123">content</invoke>');
    expect(result).not.toContain('[调用工具');
  });
});
