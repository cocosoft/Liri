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

import { describe, expect, it } from 'bun:test';
import { MultiAccountManager } from '../../src/channels/accounts';

/**
 * R11 **多账号隔离契约**（第九轮审查 §5.2："多账号同时运行时，凭证和会话状态是否隔离"）。
 *
 * `MultiAccountManager` 的设计约定：**每条通道持有自己的实例**（模块头注释）。本测试锁定
 * 该隔离性 + 解析/回退语义：
 *   A1 **实例隔离**：两个实例的账号互不可见（防"跨通道账号串号"）。
 *   A2 **精确解析**：`resolve(id)` 命中即为该账号（`fallback:false`）。
 *   A3 **回退解析**：未知 id / 空 id ⇒ 回退默认账号（`fallback:true`）。
 *   A4 **删除默认**：移除当前默认 ⇒ 默认改指剩余首个（或 null）。
 *   A5 **启用过滤**：`config.enabled === false` 的账号不进 `listEnabled`。
 */

describe('R11 多账号隔离契约', () => {
  it('A1 实例隔离：不同实例互不可见', () => {
    const a = new MultiAccountManager();
    const b = new MultiAccountManager();
    a.register({ id: 'acc-a', isDefault: true });
    b.register({ id: 'acc-b', isDefault: true });

    expect(a.listIds()).toEqual(['acc-a']);
    expect(b.listIds()).toEqual(['acc-b']);
    expect(b.get('acc-a')).toBeUndefined();
    expect(a.getDefaultId()).toBe('acc-a');
    expect(b.getDefaultId()).toBe('acc-b');
  });

  it('A2 精确解析：命中的账号 fallback=false', () => {
    const m = new MultiAccountManager();
    m.register({ id: 'x', isDefault: true });
    m.register({ id: 'y' });
    const r = m.resolve('y');
    expect(r?.account.id).toBe('y');
    expect(r?.fallback).toBe(false);
  });

  it('A3 回退解析：未知 id / 空 id ⇒ 默认账号（fallback=true）', () => {
    const m = new MultiAccountManager();
    m.register({ id: 'def', isDefault: true });
    m.register({ id: 'other' });

    const unknown = m.resolve('nope');
    expect(unknown?.account.id).toBe('def');
    expect(unknown?.fallback).toBe(true);

    const empty = m.resolve(null);
    expect(empty?.account.id).toBe('def');
    expect(empty?.fallback).toBe(false); // 空 id 直接取默认，非"回退"
  });

  it('A3b 无任何账号 ⇒ resolve 返回 null', () => {
    expect(new MultiAccountManager().resolve('anything')).toBeNull();
  });

  it('A4 删除默认账号 ⇒ 默认改指剩余首个；清空后为 null', () => {
    const m = new MultiAccountManager();
    m.registerMany([{ id: 'd1', isDefault: true }, { id: 'd2' }]);
    expect(m.getDefaultId()).toBe('d1');

    m.remove('d1');
    expect(m.getDefaultId()).toBe('d2');

    m.remove('d2');
    expect(m.getDefaultId()).toBeNull();
  });

  it('A5 启用过滤：enabled=false 的账号不进 listEnabled', () => {
    const m = new MultiAccountManager();
    m.registerMany([
      { id: 'on', isDefault: true },
      { id: 'off', config: { enabled: false } },
    ]);
    expect(m.listEnabled().map((a) => a.id)).toEqual(['on']);
  });
});
