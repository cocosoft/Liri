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
 * ContextCompactor 门面拆分回归测试（ChatManager 拆分第 3 步）
 * 验证压缩边界检测/会话压缩/压缩服务访问在门面提取后行为一致。
 */
import { describe, test, expect } from 'bun:test';
import { createChatManager } from '../../ChatManager';

describe('ContextCompactor 门面拆分回归', () => {
  test('getCompactService 返回压缩服务实例', () => {
    const cm = createChatManager();
    const svc = cm.getCompactService();
    expect(svc).toBeTruthy();
  });

  test('checkCompactBoundary：无当前会话返回 null', async () => {
    const cm = createChatManager();
    expect(await cm.checkCompactBoundary()).toBeNull();
  });

  test('checkCompactBoundary：新会话低消息量返回 null', async () => {
    const cm = createChatManager();
    const s = await cm.createSession({ title: 'Compactor-Test' });
    // 新会话消息很少，不应触发压缩边界
    expect(await cm.checkCompactBoundary(s.id)).toBeNull();
  });

  test('compactSession：无当前会话返回空数组', async () => {
    const cm = createChatManager();
    expect(await cm.compactSession()).toEqual([]);
  });

  test('compactSession：新会话返回压缩产物数组（可能含自动摘要）', async () => {
    const cm = createChatManager();
    const s = await cm.createSession({ title: 'Compactor-Compact' });
    const artifacts = await cm.compactSession(s.id);
    expect(Array.isArray(artifacts)).toBe(true);
  });
});
