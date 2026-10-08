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
 * `VfsMountRegistry` 挂载注册表守卫（AI-VFS 只读试点）。
 *
 * 断言：注册 / 解析 / 重复 scheme ⇒ **明确失败**（`VFS_CONFLICT`，不静默覆盖）。
 */

import { describe, expect, it } from 'bun:test';
import { AppError } from '../../src/error';
import { VfsMountRegistry } from '../../src/vfs/VfsMountRegistry.js';
import type { IVfsDriver } from '../../src/vfs/types.js';

/** 最小桩驱动（仅用于注册表语义验证；不含任何 Mock 业务数据） */
function makeStubDriver(): IVfsDriver {
  return {
    capabilities: { read: true, write: false, list: true },
    list: async () => [],
    stat: async () => {
      throw new Error('unused');
    },
    read: async () => {
      throw new Error('unused');
    },
    write: async () => {
      throw new Error('unused');
    },
  };
}

describe('VfsMountRegistry', () => {
  it('registerMount / resolve / has / listSchemes', () => {
    const registry = new VfsMountRegistry();
    const driver = makeStubDriver();
    registry.registerMount('dev_docs', driver);

    expect(registry.resolve('dev_docs')).toBe(driver);
    expect(registry.has('dev_docs')).toBe(true);
    expect(registry.listSchemes()).toEqual(['dev_docs']);
  });

  it('重复 scheme ⇒ 明确失败（VFS_CONFLICT，不覆盖）', () => {
    const registry = new VfsMountRegistry();
    const first = makeStubDriver();
    registry.registerMount('dev_docs', first);

    try {
      registry.registerMount('dev_docs', makeStubDriver());
      throw new Error('未抛出异常');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('VFS_CONFLICT');
    }
    // 首个驱动未被覆盖
    expect(registry.resolve('dev_docs')).toBe(first);
  });

  it('未注册 scheme ⇒ resolve 返回 null（不回退本地文件系统，CS03）', () => {
    const registry = new VfsMountRegistry();
    expect(registry.resolve('nope')).toBeNull();
    expect(registry.has('nope')).toBe(false);
  });
});
