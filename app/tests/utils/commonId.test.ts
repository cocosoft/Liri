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
 * C1 — 统一 ID 熵源（2026-10-09；**R1 修订** 2026-10-09，第九轮审查 §3.3）
 *
 * `generateId` / `randomIdSuffix` 以 crypto 供熵；本文件校验**确定性契约**与**统计观察**。
 *
 * **为什么改（根因）**：原用例「批量生成 2000 必须零重复」是**随机零碰撞硬断言** ——
 * 6 位十六进制（≈1670 万空间）下批量 2000 的碰撞概率 ≈ 12% ⇒ 该断言**本身必然偶发失败**
 * （flaky，台账 L-6）；它暴露的是**生成器熵宽不足**，而非"测试环境不稳定"。
 *
 * **修法**：① 身份类 ID 后缀位宽提升到 **10 hex（40 bit）**；② 断言拆为
 * **确定性契约**（形态 + 位宽下限，可稳定守护）与**统计观察**（宽松界，**不作**零碰撞硬断言）。
 */
import { describe, it, expect } from 'bun:test';
import { generateId, randomIdSuffix } from '../../src/utils/common.js';

describe('C1 统一 ID 熵源 —— 确定性契约', () => {
  it('generateId 保持 `prefix_timestamp_suffix` 形态', () => {
    const id = generateId('msg');
    const parts = id.split('_');
    expect(parts.length).toBe(3);
    expect(parts[0]).toBe('msg');
    expect(/^\d+$/.test(parts[1])).toBe(true);
  });

  it('【契约】generateId 后缀位宽 ≥ 10 hex（40 bit）—— 防回退', () => {
    // 直接守护 R1 的修复：身份类 ID 后缀**不得**退回 6/7 位（历史缺陷：批量碰撞）。
    expect(generateId('x')).toMatch(/^x_\d+_[0-9a-f]{10,}$/);
  });

  it('randomIdSuffix：长度与字符集（十六进制）', () => {
    expect(/^[0-9a-f]{4}$/.test(randomIdSuffix(4))).toBe(true);
    expect(/^[0-9a-f]{8}$/.test(randomIdSuffix())).toBe(true);
    // 身份类 ID 契约位宽
    expect(randomIdSuffix(10)).toHaveLength(10);
    expect(/^[0-9a-f]{10}$/.test(randomIdSuffix(10))).toBe(true);
  });
});

describe('C1 ID 生成 —— 统计观察（非零碰撞硬断言）', () => {
  it('批量生成的碰撞率远低于阈值（不因随机而 flaky）', () => {
    const N = 20000;
    const set = new Set<string>();
    for (let i = 0; i < N; i++) set.add(generateId('x'));
    const collisionRate = (N - set.size) / N;

    // 10 hex（40 bit）下期望碰撞率 ≈ N/(2·2^40) ≈ 1.8e-5；阈值取 1% 留足裕量。
    // 本断言**只用于观察**（捕捉"熵源严重退化"量级的问题），**不作**每次 CI 必须零碰撞的硬断言
    // —— 这才是原先 flaky 的根因。
    expect(collisionRate).toBeLessThan(0.01);
  });
});
