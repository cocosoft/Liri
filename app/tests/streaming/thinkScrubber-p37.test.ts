// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P3-7d/c 回归测试（2026-09-02）
 *
 * P3-7c：StreamingThinkScrubber normal 模式缓存半截闭合标签——模型逐字符输出
 *   "</tool_calls>" 时 "</"、 "</tool" 等半截闭合标签此前泄露到正文（实测轨迹
 *   seq 1302-1307），修复后整块剥离。
 * P3-7d：stripThinkResponseTags 处理"未闭合 think 块"——模型以 "</parameter>\n\n
 *   </tool_calls>" XML 残渣闭合思考内容（无配对 </think>），此前整个思考草稿
 *   作为最终正文交付（实测最终消息 251 字符纯 think）。
 */
import { describe, it, expect } from 'bun:test';
import { StreamingThinkScrubber } from '../../src/streaming/scrubbers/StreamingThinkScrubber.js';
import { stripThinkResponseTags } from '../../src/chat/services/MessageContextPipeline.js';

describe('P3-7c StreamingThinkScrubber 半截闭合标签', () => {
  it('逐字符 "</tool_calls>" 不泄露到正文（normal 模式缓存半截闭合标签）', () => {
    const s = new StreamingThinkScrubber();
    const parts: string[] = [];
    for (const ch of ['</', 'tool', '_c', 'alls', '>', '正文']) {
      const r = s.scrub({ content: ch, isComplete: false });
      parts.push(r.content ?? '');
    }
    parts.push(s.flush());
    const out = parts.join('');
    expect(out).not.toContain('tool_calls');
    expect(out).not.toContain('</');
    expect(out).toBe('正文');
  });

  it('半截 "</parameter>" 同样剥离', () => {
    const s = new StreamingThinkScrubber();
    const parts: string[] = [];
    for (const ch of ['</para', 'meter>', '正文内容']) {
      const r = s.scrub({ content: ch, isComplete: false });
      parts.push(r.content ?? '');
    }
    parts.push(s.flush());
    const out = parts.join('');
    expect(out).not.toContain('parameter');
    expect(out).toBe('正文内容');
  });
});

describe('P3-7d stripThinkResponseTags 未闭合 think 块', () => {
  it('模型以 "</parameter></tool_calls>" 闭合思考内容 → 整个思考草稿剥离（不交付）', () => {
    const content =
      '<think>搜索预算已达上限，停止继续搜索。基于已获得的两轮搜索结果整合产出日报。todo_write 工具加载失败且被 STEERING 禁止继续探索，改为直接交付 HTML 产出物。现在写 HTML 文件。</parameter>\n\n</tool_calls>';
    const stripped = stripThinkResponseTags(content);
    expect(stripped).toBe('');
  });

  it('配对 <think>...</think> 剥离内容保留正文（不回归）', () => {
    const stripped = stripThinkResponseTags('正常正文<think>内部推理</think>保留内容');
    expect(stripped).toBe('正常正文保留内容');
  });

  it('无 think 标签的正文原样保留', () => {
    const text = '这是一段正常回复，不包含任何标签。';
    expect(stripThinkResponseTags(text)).toBe(text);
  });
});
