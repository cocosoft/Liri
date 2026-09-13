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
 * AutoModeClassifier 拆分回归测试（FSZ-003）
 * 验证 classify 的检测行为与拆分前一致（白名单/危险关键词/命令模式/注入/零宽字符）。
 */
import { describe, test, expect } from 'bun:test';
import { AutoModeClassifier } from '../AutoModeClassifier';

const classifier = new AutoModeClassifier();

async function classify(toolName: string, input: Record<string, unknown> = {}) {
  return classifier.classify(toolName, input, []);
}

describe('AutoModeClassifier 拆分回归（FSZ-003）', () => {
  test('isAllowlistedTool: 白名单工具返回 true', () => {
    expect(classifier.isAllowlistedTool('read')).toBe(true);
    expect(classifier.isAllowlistedTool('list_files')).toBe(true);
  });

  test('isAllowlistedTool: 危险关键词非白名单', () => {
    expect(classifier.isAllowlistedTool('rm')).toBe(false);
    expect(classifier.isAllowlistedTool('sudo')).toBe(false);
  });

  test('classify: 白名单工具直接放行', async () => {
    const d = await classify('read', { path: '/etc/passwd' });
    expect(d.shouldBlock).toBe(false);
  });

  test('classify: 危险工具关键词（完整单词匹配）阻断', async () => {
    const d = await classify('rm', { target: '/data' });
    expect(d.shouldBlock).toBe(true);
    expect(d.reason).toContain('dangerous keyword');
  });

  test('classify: 危险命令模式（rm -rf）阻断', async () => {
    const d = await classify('bash', { command: 'rm -rf /' });
    expect(d.shouldBlock).toBe(true);
    expect(d.reason).toContain('dangerous command pattern');
  });

  test('classify: SQL 注入（union select）阻断', async () => {
    const d = await classify('query', {
      sql: 'select * from users union select 1,2',
    });
    expect(d.shouldBlock).toBe(true);
    expect(d.reason).toContain('SQL injection');
  });

  test('classify: Unicode 零宽字符阻断', async () => {
    const d = await classify('run', { text: 'evil\u200Binput' });
    expect(d.shouldBlock).toBe(true);
  });

  test('classify: 安全输入放行', async () => {
    const d = await classify('search', { keyword: 'hello world' });
    expect(d.shouldBlock).toBe(false);
  });
});
