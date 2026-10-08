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
 * VfsMountRegistry —— 挂载点注册表（`ai-vfs-driver-contract.md` §3.3）。
 *
 * **唯一注册面**：scheme → `IVfsDriver`。装配在 `entrypoints/` 组合根
 * （`entrypoints/vfsWiring.ts`）；❌ 禁止业务模块内自建 Map。
 *
 * 解析基于**结构化 scheme 精确查表** —— 不做字符串前缀匹配（CS02）。
 */

import { vfsError, type IVfsDriver } from './types.js';

export class VfsMountRegistry {
  private readonly mounts = new Map<string, IVfsDriver>();

  /**
   * 注册挂载点。
   *
   * 重复 scheme ⇒ **明确失败**（`VFS_CONFLICT`）—— 不做静默覆盖 / 回退（CS03）。
   */
  registerMount(scheme: string, driver: IVfsDriver): void {
    if (this.mounts.has(scheme)) {
      throw vfsError('VFS_CONFLICT', `挂载点已注册，不允许覆盖: "${scheme}"`, {
        scheme,
      });
    }
    this.mounts.set(scheme, driver);
  }

  /** 已注册 ⇒ 返回驱动；未注册 ⇒ `null`（由调用方转 `VFS_UNKNOWN_MOUNT`） */
  resolve(scheme: string): IVfsDriver | null {
    return this.mounts.get(scheme) ?? null;
  }

  /** 是否已注册该 scheme */
  has(scheme: string): boolean {
    return this.mounts.has(scheme);
  }

  /** 已注册 scheme 清单（诊断 / 测试用） */
  listSchemes(): string[] {
    return [...this.mounts.keys()];
  }
}

/** 全局挂载注册表（唯一实例；装配面 = `entrypoints/vfsWiring.ts`） */
export const vfsMountRegistry = new VfsMountRegistry();
