// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * StreamingToolCallScrubber 边缘情况测试
 *
 * 验证修复后不存在导致输出截断的残留风险。
 */
import { describe, it, expect } from 'bun:test';
import { StreamingToolCallScrubber } from '../../src/streaming/scrubbers/StreamingToolCallScrubber.js';

function simulate(chunks: string[], flush = true): string {
  const s = new StreamingToolCallScrubber();
  const parts: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const r = s.scrub({ content: chunks[i], isComplete: i === chunks.length - 1 });
    parts.push(r.content ?? '');
  }
  if (flush) parts.push(s.flush());
  return parts.join('');
}

describe('StreamingToolCallScrubber — 边缘情况', () => {
  // ─── 1：真实工具调用未闭合（流中断） ──────

  it('工具调用开标签后流中断 — flush 恢复状态', () => {
    const r1 = simulate([
      '开始\n',
      '<tool_call>{"name":"search","args":{"q":"', // 未闭合
    ], false); // 不 flush，模拟中断
    // 中断时：已进入擦除模式，前导文本保留，工具调用内容隐藏
    expect(r1).toContain('开始');
    expect(r1).toContain('[调用工具');
    expect(r1).not.toContain('search');

    // 新 scrubber 实例（模拟重连后新流）
    const r2 = simulate(['重新开始输出。'], true);
    expect(r2).toBe('重新开始输出。');
  });

  it('工具调用未闭合 + flush — 清空状态', () => {
    const result = simulate([
      '文本前\n',
      '<tool_call>{"name":"incomplete"', // 永不闭合
    ], true);
    // flush 后：工具调用内容被隐藏但状态重置
    expect(result).toContain('文本前');
    expect(result).toContain('[调用工具');
    expect(result).not.toContain('incomplete');
  });

  // ─── 2：多个连续工具调用 ──────

  it('两个连续 Hermes tool_call', () => {
    const result = simulate([
      '<tool_call>{"name":"a","arguments":{}}</tool_call>',
      '<tool_call>{"name":"b","arguments":{}}</tool_call>',
    ]);
    expect(result).toContain('[调用工具');
    expect(result).not.toContain('{"name"');
    // 进度提示应出现两次（两个独立的工具调用）
    const match = result.match(/调用工具/g);
    expect(match).not.toBeNull();
    expect(match!.length).toBe(2);
  });

  it('工具调用 + 正文 + 工具调用', () => {
    const result = simulate([
      '<tool_call>{"name":"read","arguments":{}}</tool_call>',
      '文件内容如下：\n',
      '<tool_call>{"name":"write","arguments":{}}</tool_call>',
    ]);
    expect(result).toContain('文件内容如下：');
    expect(result).not.toContain('read');
    expect(result).not.toContain('write');
  });

  // ─── 3：关闭标签数量异常 ──────

  it('多余关闭标签不应影响后续输出', () => {
    const result = simulate([
      '<tool_call>{"name":"f","arguments":{}}</tool_call>',
      '</tool_call>', // 多余的关闭标签（不在擦除模式中）
      '后续文本',
    ]);
    // 多余的 </tool_call> 在非工具调用模式下，作为普通文本输出
    // 但它以 `<` 开头，不是工具调用开标签 → 不进入擦除模式
    // isIncompleteOpenTag('</tool_call>') → startsWith('</tool_call') → 等待 >
    // 但 </tool_call> 包含 > → 不匹配
    // 所以 </tool_call 等前缀会在字符循环中逐个输出
    expect(result).toContain('后续文本');
  });

  it('关闭标签比开标签多（depth < 0）— 正确复位', () => {
    const result = simulate([
      '<tool_call>{"name":"f","arguments":{}}</tool_call>',
      '</tool_call>', // 多余关闭
      '<tool_call>{"name":"g","arguments":{}}</tool_call>',
      '结束',
    ]);
    // 第二个真实工具调用应被擦除
    expect(result).not.toContain('{"name":"g"');
    expect(result).toContain('结束');
  });

  // ─── 4：pending 状态边界 ──────

  it('pending 后收到空 chunk — 应原样 flush', () => {
    const s = new StreamingToolCallScrubber();
    // chunk1: 标签在末尾
    s.scrub({ content: '<tool_call>', isComplete: false });
    // chunk2: 空
    s.scrub({ content: '', isComplete: false });
    // chunk3: 普通文本
    const r3 = s.scrub({ content: '普通文本', isComplete: true });
    const flushed = s.flush();
    const full = (r3.content ?? '') + flushed;
    // pending 缓冲在 openBuffer，空 chunk 不处理（提前返回）
    // 第三次调用时: content = '<tool_call>' + '普通文本' → 验证不通过 → 作为文本输出
    expect(full).toContain('<tool_call>普通文本');
  });

  it('invoke pending 后无后续 — flush 恢复标签', () => {
    const s = new StreamingToolCallScrubber();
    s.scrub({ content: '<invoke name="do_something">', isComplete: false });
    // 无后续 chunk，直接 flush
    const flushed = s.flush();
    // pending 时 openBuffer 存储了标签，flush 在 !inToolCall 时返回它
    expect(flushed).toContain('<invoke');
    expect(flushed).toContain('do_something');
  });

  // ─── 5：混合标签类型 ──────

  it('tool_call 后紧跟 invoke（都在正文中）', () => {
    const result = simulate([
      '可用格式：',
      '<tool_call>',
      ' 和 ',
      '<invoke>',
      ' 两种。',
    ]);
    expect(result).toContain('<tool_call>');
    expect(result).toContain('<invoke>');
    expect(result).toContain('两种');
    expect(result).not.toContain('[调用工具');
  });

  // ─── 6：大型 JSON 工具调用参数 ──────

  it('大型 JSON 参数不导致截断', () => {
    const bigJson = JSON.stringify({
      name: 'process',
      arguments: { data: 'x'.repeat(5000) },
    });
    const result = simulate([
      `<tool_call>${bigJson}</tool_call>`,
      '处理完成。',
    ]);
    expect(result).toContain('处理完成。');
    expect(result).not.toContain('xxxx');
  });

  // ─── 7：深度嵌套 ──────

  it('tool_calls 深度嵌套应正确擦除', () => {
    const result = simulate([
      '<tool_calls>',
      '<tool_call>{"name":"a"}</tool_call>',
      '<tool_call>{"name":"b"}</tool_call>',
      '</tool_calls>',
      '完成',
    ]);
    expect(result).toContain('完成');
    expect(result).not.toContain('tool_call');
    expect(result).not.toContain('tool_calls');
  });

  // ─── 8：isComplete 信号对缓冲的影响 ──────

  it('isComplete=true 且 pending — 下一调用正常处理', () => {
    const s = new StreamingToolCallScrubber();
    const r1 = s.scrub({ content: '<tool_call>', isComplete: true });
    // isComplete 不影响 pending 行为，标签仍被缓冲
    expect(r1.content).toBe('');
    // 下一调用
    const r2 = s.scrub({ content: '后续文本', isComplete: true });
    const flushed = s.flush();
    const full = (r2.content ?? '') + flushed;
    expect(full).toContain('<tool_call>后续文本');
  });

  // ─── 9：仅含 < 的碎片 ──────

  it('单个 < 字符在 chunk 末尾 → 不缓冲', () => {
    const result = simulate(['文本 <', '/tool_call> 不是标签']);
    // `<` 后跟 `/tool_call>` → 首先检查开标签匹配 → 不匹配（以 </ 开头）
    // 输出 `<`，然后 `/`，然后 `t`...
    // `</tool_call>` 在非擦除模式下 → isIncompleteOpenTag? startsWith('<tool_call')? No.
    // startsWith('<tool_calls')? No. startsWith('<invoke')? No.
    // → 输出字符
    // 实际上 `</tool_call>` 不是开标签，也不匹配 isIncompleteOpenTag（因为以 `</` 开头而不是 `<tool_call`）
    // Wait: isIncompleteOpenTag checks `remaining.startsWith('<tool_call')` etc.
    // `</tool_call>` doesn't start with `<tool_call` → false
    // So each character is output individually
    expect(result).toContain('</tool_call>');
    expect(result).toContain('不是标签');
    expect(result).not.toContain('[调用工具');
  });

  // ─── 10：reset 后重用 ──────

  it('reset 后可以重新处理正常工具调用', () => {
    const s = new StreamingToolCallScrubber();
    // 第一次：trigger a fake call
    s.scrub({ content: '正文 <tool_call> 说明', isComplete: true });
    s.flush();
    s.reset();
    // 第二次：real tool call
    const r = s.scrub({ content: '<tool_call>{"name":"f"}</tool_call>', isComplete: true });
    const flushed = s.flush();
    expect((r.content ?? '') + flushed).toContain('[调用工具');
    expect((r.content ?? '') + flushed).not.toContain('{"name"');
  });
});
