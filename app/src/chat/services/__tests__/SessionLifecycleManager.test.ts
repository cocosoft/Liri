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
 * SessionLifecycleManager 门面拆分回归测试（ChatManager 拆分第 1 步）
 * 验证会话状态共享（Map 引用 + currentSessionId 端口）在 ChatManager 与门面间一致。
 */
import { describe, test, expect } from 'bun:test';
import { createChatManager } from '../../ChatManager';

describe('SessionLifecycleManager 门面拆分回归', () => {
  test('createSession 创建会话并设为当前', async () => {
    const cm = createChatManager();
    const s = await cm.createSession({ title: 'Facade-Test-1' });
    expect(s.id).toBeTruthy();
    expect(s.title).toBe('Facade-Test-1');
    expect(cm.getCurrentSession()?.id).toBe(s.id);
    expect(cm.getSessions().length).toBe(1);
  });

  test('多次 createSession 更新当前会话', async () => {
    const cm = createChatManager();
    const s1 = await cm.createSession({ title: 'Facade-Test-2a' });
    const s2 = await cm.createSession({ title: 'Facade-Test-2b' });
    expect(cm.getCurrentSession()?.id).toBe(s2.id);
    expect(cm.getSessions().length).toBe(2);
    expect(cm.getSessions().some((x) => x.id === s1.id)).toBe(true);
  });

  test('getSessionMessages 返回会话消息', async () => {
    const cm = createChatManager();
    const s = await cm.createSession({ title: 'Facade-Test-3' });
    expect(cm.getSessionMessages(s.id)).toEqual([]);
    expect(cm.getSessionMessages('nonexistent')).toEqual([]);
  });

  test('deleteSession 删除当前会话并清空当前指针', async () => {
    const cm = createChatManager();
    const s = await cm.createSession({ title: 'Facade-Test-4' });
    cm.deleteSession(s.id);
    expect(cm.getSessions().some((x) => x.id === s.id)).toBe(false);
    expect(cm.getCurrentSession()).toBeUndefined();
  });

  test('switchSession 切换当前会话', async () => {
    const cm = createChatManager();
    const s1 = await cm.createSession({ title: 'Facade-Switch-1' });
    const s2 = await cm.createSession({ title: 'Facade-Switch-2' });
    await cm.switchSession(s1.id);
    expect(cm.getCurrentSession()?.id).toBe(s1.id);
    await cm.switchSession(s2.id);
    expect(cm.getCurrentSession()?.id).toBe(s2.id);
  });
});
