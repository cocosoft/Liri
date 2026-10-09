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
 * C1 — 统一 ID 熵源（2026-10-09）
 *
 * `generateId` / `randomIdSuffix` 以 crypto 供熵；校验形态与唯一性。
 */
import { describe, it, expect } from 'bun:test';
import { generateId, randomIdSuffix } from '../../src/utils/common.js';

describe('C1 统一 ID 熵源', () => {
  it('generateId 保持 `prefix_timestamp_suffix` 形态', () => {
    const id = generateId('msg');
    const parts = id.split('_');
    expect(parts.length).toBe(3);
    expect(parts[0]).toBe('msg');
    expect(/^\d+$/.test(parts[1])).toBe(true);
    expect(/^[0-9a-f]{6}$/.test(parts[2])).toBe(true);
  });

  it('唯一性：批量生成无重复', () => {
    const set = new Set<string>();
    for (let i = 0; i < 2000; i++) set.add(generateId('x'));
    expect(set.size).toBe(2000);
  });

  it('randomIdSuffix：长度与字符集（十六进制）', () => {
    expect(/^[0-9a-f]{4}$/.test(randomIdSuffix(4))).toBe(true);
    expect(/^[0-9a-f]{8}$/.test(randomIdSuffix())).toBe(true);
  });
});
