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
 * toolCategories 回归测试（2026-09-01）
 *
 * P0 修复：knowledge_save 此前未登记类别（misc）被 default/chat 白名单裁剪，
 * 导致"保存到知识库"在 default 任务下模型无保存工具 → 循环搜索 → 30 轮截断。
 * 修复后 knowledge_save 归 knowledge 类别、技能工具归 search 类别。
 * 本测试固化：核心工具在 default/chat 白名单内可见，防止再次被裁剪。
 */

import { describe, expect, test } from 'bun:test';
import { filterToolsByTask, getToolCategory } from '../../src/tools/toolCategories';

const CORE_TOOLS = [
  'knowledge_save',
  'knowledge_search',
  'knowledge_write',
  'skill_view',
  'skills_list',
  'Skill',
  'tool_search',
  'web_fetch',
];

describe('toolCategories — P0 工具可见性回归', () => {
  test('knowledge_save 归 knowledge 类别', () => {
    expect(getToolCategory('knowledge_save')).toBe('knowledge');
    expect(getToolCategory('knowledge_search')).toBe('knowledge');
    expect(getToolCategory('knowledge_write')).toBe('knowledge');
  });

  test('技能工具归 search 类别（与 tool_search 同链）', () => {
    expect(getToolCategory('skill_view')).toBe('search');
    expect(getToolCategory('skills_list')).toBe('search');
    expect(getToolCategory('Skill')).toBe('search');
  });

  test('default 任务白名单保留核心工具（knowledge_save + 技能工具）', () => {
    const defs = CORE_TOOLS.map((name) => ({ name }));
    const kept = filterToolsByTask(defs, 'default').map((t) => t.name);
    for (const name of CORE_TOOLS) {
      expect(kept).toContain(name);
    }
  });

  test('chat 任务白名单保留核心工具', () => {
    const defs = CORE_TOOLS.map((name) => ({ name }));
    const kept = filterToolsByTask(defs, 'chat').map((t) => t.name);
    for (const name of CORE_TOOLS) {
      expect(kept).toContain(name);
    }
  });
});
