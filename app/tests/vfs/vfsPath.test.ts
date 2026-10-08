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
 * `VfsPath` 结构化解析守卫（AI-VFS 只读试点）。
 *
 * 断言：解析产出结构化 `{scheme, authority, path}`（**禁止**字符串前缀匹配，CS02）；
 * 缺失 / 非法 scheme ⇒ `VFS_UNKNOWN_MOUNT`（**不**回退本地文件系统，CS03）。
 */

import { describe, expect, it } from 'bun:test';
import { AppError } from '../../src/error';
import {
  formatVfsPath,
  parseVfsPath,
  vfsRelativePath,
} from '../../src/vfs/VfsPath.js';

function expectVfsCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error('未抛出异常');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
  }
}

describe('parseVfsPath：结构化解析（非字符串前缀匹配）', () => {
  it('dev_docs://配置与安全/sandbox.md ⇒ {scheme, authority, path}', () => {
    expect(parseVfsPath('dev_docs://配置与安全/sandbox.md')).toEqual({
      scheme: 'dev_docs',
      authority: '配置与安全',
      path: 'sandbox.md',
    });
  });

  it('dev_docs:// ⇒ 根（authority / path 均为空串）', () => {
    expect(parseVfsPath('dev_docs://')).toEqual({
      scheme: 'dev_docs',
      authority: '',
      path: '',
    });
  });

  it('多段路径 ⇒ 仅首段为 authority，其余并入 path', () => {
    expect(parseVfsPath('dev_docs://核心模块/sub/README.md')).toEqual({
      scheme: 'dev_docs',
      authority: '核心模块',
      path: 'sub/README.md',
    });
  });

  it('三斜杠形态 dev_docs:///a ⇒ authority 为空', () => {
    expect(parseVfsPath('dev_docs:///a')).toEqual({
      scheme: 'dev_docs',
      authority: '',
      path: 'a',
    });
  });

  it('scheme 精确匹配（不做前缀）：dev_docs_extra 不归 dev_docs', () => {
    expect(parseVfsPath('dev_docs_extra://x').scheme).toBe('dev_docs_extra');
  });

  it('缺失 scheme:// ⇒ VFS_UNKNOWN_MOUNT', () => {
    expectVfsCode(
      () => parseVfsPath('配置与安全/sandbox.md'),
      'VFS_UNKNOWN_MOUNT'
    );
    expectVfsCode(() => parseVfsPath(''), 'VFS_UNKNOWN_MOUNT');
  });

  it('非法 scheme（数字开头 / 非法字符）⇒ VFS_UNKNOWN_MOUNT', () => {
    expectVfsCode(() => parseVfsPath('1abc://x'), 'VFS_UNKNOWN_MOUNT');
    expectVfsCode(() => parseVfsPath('a b://x'), 'VFS_UNKNOWN_MOUNT');
  });

  it('穿越输入被**结构化**解析（拒绝由驱动底座负责，非字符串前缀判定）', () => {
    const p = parseVfsPath('dev_docs://../../~/.pyapp/config.json');
    expect(p).toEqual({
      scheme: 'dev_docs',
      authority: '..',
      path: '../~/.pyapp/config.json',
    });
    // 相对路径可无损重建 ⇒ 驱动据此做归一化与逃逸判定
    expect(vfsRelativePath(p)).toBe('../../~/.pyapp/config.json');
    expect(formatVfsPath(p)).toBe('dev_docs://../../~/.pyapp/config.json');
  });
});
