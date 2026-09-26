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
 * 崩溃恢复重算 `totalMessages` 的**落盘判据**（2026-09-26，`.trash` 高速累积根因 ①-1b）。
 *
 * 实测量级：`chat:manager 崩溃恢复重算 totalMessages 落盘 {before:85, after:0}` —— 消息文件
 * 丢失时 `dedupedMessages` 恒为 `[]`，旧实现仍把 0 回写，于是（a）把"文件已丢失"固化成
 * `totalMessages: 0` 掩盖真相，（b）借 `persistSession` 的 `mkdir(recursive)` 把已软删目录
 * 重建 ⇒ 与 K-6 自愈构成无终止循环（单会话被删 533 次）。
 */
import { describe, expect, test } from 'bun:test';
import { shouldPersistRecalculatedTotal } from '../../src/chat/ChatManager';

describe('shouldPersistRecalculatedTotal：重算结果为空时不落盘', () => {
  test('消息文件丢失（重算 0、原值非 0）⇒ 不落盘（根因回归）', () => {
    expect(shouldPersistRecalculatedTotal(85, 0)).toBe(false);
  });

  test('确有消息且与旧值不同 ⇒ 落盘（一次性数据修复路径不受影响）', () => {
    expect(shouldPersistRecalculatedTotal(85, 61)).toBe(true);
    expect(shouldPersistRecalculatedTotal(undefined, 3)).toBe(true);
  });

  test('与旧值相同 ⇒ 不落盘（无修复价值，避免每次启动白写一次）', () => {
    expect(shouldPersistRecalculatedTotal(5, 5)).toBe(false);
  });

  test('本就为空（0 / undefined → 0）⇒ 不落盘', () => {
    expect(shouldPersistRecalculatedTotal(0, 0)).toBe(false);
    expect(shouldPersistRecalculatedTotal(undefined, 0)).toBe(false);
  });
});
