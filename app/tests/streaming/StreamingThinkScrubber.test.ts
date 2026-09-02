// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * StreamingThinkScrubber 回归测试（2026-09-01）
 *
 * P1 修复：模型收尾输出 XML 工具调用残渣（<invoke>/<parameter>/</tool_calls>）
 * 作为正文透传。修复：擦除标签列表扩展 XML 工具标签 + normal 模式丢弃孤立闭合标签。
 */

import { describe, expect, test } from 'bun:test';
import { StreamingThinkScrubber } from '../../src/streaming/scrubbers/StreamingThinkScrubber';

function scrubStream(scrubber: StreamingThinkScrubber, chunks: string[]): string {
  let out = '';
  for (const c of chunks) {
    out += scrubber.scrub({ content: c, isComplete: false }).content;
  }
  out += scrubber.flush();
  return out;
}

describe('StreamingThinkScrubber — XML 工具调用残渣剥离（P1）', () => {
  test('完整 XML tool_calls 块整块擦除', () => {
    const s = new StreamingThinkScrubber();
    const input =
      '<tool_calls>\n<invoke name="grep">\n<parameter name="pattern">xxx</parameter>\n</invoke>\n</tool_calls>\n结果是干净的。';
    expect(scrubStream(s, [input])).toBe('\n结果是干净的。');
  });

  test('孤立闭合标签（</parameter> 等单边残渣）被丢弃', () => {
    const s = new StreamingThinkScrubber();
    const input = '跑），告诉我结果。\n</parameter>\n</invoke>\n</tool_calls>\n收到。';
    expect(scrubStream(s, [input])).toBe('跑），告诉我结果。\n\n\n\n收到。');
  });

  test('跨 chunk 边界的 XML 块擦除', () => {
    const s = new StreamingThinkScrubber();
    const chunks = [
      '前文。',
      '<invo',
      'ke name="glob"><param',
      'eter name="pattern">**/*.ts</parameter></invoke>',
      '后文。',
    ];
    expect(scrubStream(s, chunks)).toBe('前文。后文。');
  });

  test('think/response 原有行为不回退', () => {
    const s = new StreamingThinkScrubber();
    const input =
      '<think>\n内部推理\n</think>\n<response>\n回答内容\n</response>';
    // think 块与 response 块之间的 \n 保留（分隔符非思考内容）
    expect(scrubStream(s, [input])).toBe('\n\n回答内容\n');
  });

  test('正常文本中的 parameter 字样（无尖括号）不被误伤', () => {
    const s = new StreamingThinkScrubber();
    const input = '讨论 parameter 与 invoke 的区别。';
    expect(scrubStream(s, [input])).toBe(input);
  });
});
