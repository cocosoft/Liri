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
 * 「写后读回」机械保障的**纯函数**守卫（2026-10-08）。
 *
 * 背景：验收标准普遍形如「`file_read` 读取 X 返回内容为 v」，而提示词层的"写后读回"只是
 * **引导**（真机实测执行器常漏做）⇒ 审查（正确地）判"验收标准未被实际验证"⇒ 步骤 failed。
 * 现由编排器机械补做读回；本文件锁住两个判定：
 * ① `classifyArtifactAccess` 的读写分类（**派生自 `TOOL_CATEGORIES`**，不手写工具名）；
 * ② `collectPendingReadBacks` 的待补读选集（已读/重复剔除 + 上限）。
 */
import { describe, expect, it } from 'bun:test';
import {
  classifyArtifactAccess,
  collectPendingReadBacks,
} from '../../src/tasks/LongRunningTaskOrchestrator';

describe('classifyArtifactAccess：读写分类派生自 TOOL_CATEGORIES', () => {
  it('写类工具（category=file）判为 write 并取 file_path', () => {
    expect(
      classifyArtifactAccess('file_write', { file_path: '/tmp/a.txt' })
    ).toEqual({ kind: 'write', path: '/tmp/a.txt' });
    expect(
      classifyArtifactAccess('file_edit', { file_path: '/tmp/a.txt' })
    ).toEqual({ kind: 'write', path: '/tmp/a.txt' });
  });

  it('读类工具（category=file_read）判为 read；兼容别名 path', () => {
    expect(
      classifyArtifactAccess('file_read', { file_path: '/tmp/a.txt' })
    ).toEqual({ kind: 'read', path: '/tmp/a.txt' });
    expect(classifyArtifactAccess('glob', { path: '/tmp' })).toEqual({
      kind: 'read',
      path: '/tmp',
    });
  });

  it('非文件类工具 / 缺路径 / 空白路径 ⇒ undefined（不参与读回保障）', () => {
    expect(classifyArtifactAccess('bash', { command: 'ls' })).toBeUndefined();
    expect(classifyArtifactAccess('grep', { pattern: 'x' })).toBeUndefined();
    expect(
      classifyArtifactAccess('file_write', { content: 'x' })
    ).toBeUndefined();
    expect(
      classifyArtifactAccess('file_write', { file_path: '   ' })
    ).toBeUndefined();
    expect(classifyArtifactAccess('file_write', undefined)).toBeUndefined();
  });
});

describe('collectPendingReadBacks：待补读选集', () => {
  it('已读回的路径剔除，只留"写了没读"的', () => {
    expect(
      collectPendingReadBacks(['/tmp/a.txt', '/tmp/b.txt'], ['/tmp/a.txt'])
    ).toEqual(['/tmp/b.txt']);
  });

  it('写入路径去重，且受上限约束（默认 3）', () => {
    expect(collectPendingReadBacks(['/a', '/a', '/b'], [])).toEqual([
      '/a',
      '/b',
    ]);
    expect(collectPendingReadBacks(['/a', '/b', '/c', '/d'], [], 2)).toEqual([
      '/a',
      '/b',
    ]);
  });

  it('无可补项 ⇒ 空数组（不产生空证据块）', () => {
    expect(collectPendingReadBacks([], ['/a'])).toEqual([]);
    expect(collectPendingReadBacks(['/a'], ['/a'])).toEqual([]);
  });
});
