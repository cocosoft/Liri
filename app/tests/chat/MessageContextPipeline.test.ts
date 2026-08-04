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

import { describe, expect, test } from 'bun:test';
import {
  stripOrphanToolTags,
  stripThinkResponseTags,
  ensureThinkResponseTags,
} from '../../src/chat/services/MessageContextPipeline';

describe('stripOrphanToolTags — 孤立工具调用标签残片剥离', () => {
  test('剥离残缺工具调用闭合标签（P3 场景：模型输出 </parameter></invoke></tool_calls>）', () => {
    const input = `<response>继续读取数字化建设方案和部门职责文件：</parameter>
</invoke>
</tool_calls>`;
    const stripped = stripThinkResponseTags(input);
    const result = stripOrphanToolTags(stripped);
    expect(result).toBe('继续读取数字化建设方案和部门职责文件：');
  });

  test('剥离 scrubber REJECT 后残留的工具调用开标签', () => {
    const input = `继续读取其余文件：
<tool_calls>
<invoke name="file_convert">
<parameter name="file_path">E:\\docs\\a.docx</parameter>
</invoke>
</tool_calls>`;
    const result = stripOrphanToolTags(input);
    // 所有工具调用标签被剥离，参数内容保留（结尾 trim 去除多余换行）
    expect(result).toBe('继续读取其余文件：\n\n\nE:\\docs\\a.docx');
  });

  test('正常文本不受影响', () => {
    const input = '已完成前两份招标文件的转换，继续处理。';
    expect(stripOrphanToolTags(input)).toBe(input);
  });

  test('空内容不崩', () => {
    expect(stripOrphanToolTags('')).toBe('');
    expect(stripOrphanToolTags('   ')).toBe('');
    expect(stripOrphanToolTags(undefined as unknown as string)).toBe(undefined);
  });

  test('与 ensureThinkResponseTags + stripThinkResponseTags 组合还原真实场景', () => {
    // 模拟模型输出残缺工具调用（开标签丢失）
    const raw =
      '<response>继续读取数字化建设方案和部门职责文件：</parameter>\n</invoke>\n</tool_calls>';
    const repaired = ensureThinkResponseTags(repairLike(raw));
    const stripped = stripThinkResponseTags(repaired);
    const cleaned = stripOrphanToolTags(stripped);
    expect(cleaned).toBe('继续读取数字化建设方案和部门职责文件：');
  });
});

function repairLike(content: string): string {
  // 模拟 repairImageUrls（此处无图片 URL，原样返回）
  return content;
}
