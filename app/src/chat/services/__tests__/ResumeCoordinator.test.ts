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
 * ResumeCoordinator 门面拆分回归测试（ChatManager 拆分第 2 步）
 * 验证检查点 CRUD + 检索在门面提取后行为一致。
 */
import { describe, test, expect } from 'bun:test';
import { createChatManager } from '../../ChatManager';

describe('ResumeCoordinator 门面拆分回归', () => {
  test('检查点 CRUD 全链路', async () => {
    const cm = createChatManager();
    const s = await cm.createSession({ title: 'Resume-Test' });

    // 创建检查点
    const cpId = await cm.createCheckpoint(s.id, 'test');
    expect(cpId).toBeTruthy();

    // 列表包含
    const list = await cm.listCheckpoints(s.id);
    expect(list.some((c) => c.id === cpId)).toBe(true);

    // 最新检查点
    const latest = await cm.getLatestCheckpoint(s.id);
    expect(latest?.id).toBe(cpId);

    // 回滚
    const rb = await cm.rollbackToCheckpoint(cpId);
    expect(rb.session).toBeTruthy();

    // 删除后列表为空
    await cm.deleteCheckpoint(cpId);
    const list2 = await cm.listCheckpoints(s.id);
    expect(list2.some((c) => c.id === cpId)).toBe(false);
    expect(await cm.getLatestCheckpoint(s.id)).toBeNull();
  });

  test('getLatestCheckpoint：无检查点返回 null', async () => {
    const cm = createChatManager();
    const s = await cm.createSession({ title: 'Resume-Msgs' });
    expect(await cm.getLatestCheckpoint(s.id)).toBeNull();
  });

  test('rollbackToCheckpoint：不存在的检查点抛错', async () => {
    const cm = createChatManager();
    await expect(cm.rollbackToCheckpoint('nonexistent')).rejects.toThrow();
  });
});
