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
 * 评测任务断言辅助（D2 第 3 批）
 *
 * 只放"读终态"这类小工具，供各任务文件共用（避免每个任务文件各写一份）。
 */

import { existsSync, readFileSync } from 'node:fs';

/** 读文件内容；不存在或不可读返回 null（断言据此判"未创建"） */
export function readIfExists(filePath: string): string | null {
  try {
    return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : null;
  } catch {
    // @ignore-catch —— 读失败等同于"不可用"，交由断言判为未通过
    return null;
  }
}

/** 文件是否存在 */
export function existsFile(filePath: string): boolean {
  return existsSync(filePath);
}

/** 归一化路径（统一分隔符与大小写，用于"是否在工作区内"的比较） */
export function normalizeForCompare(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

/** 是否为绝对路径（Windows 盘符或 POSIX 根） */
export function isAbsolutePath(p: string): boolean {
  const normalized = p.replace(/\\/g, '/');
  return /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('/');
}
