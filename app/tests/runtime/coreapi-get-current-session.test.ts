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
 * CoreAPIImpl.getCurrentSession — TB-14（2026-09-24）契约锁定。
 *
 * 该方法是"幽灵会话 id"暴露给前端的**唯一 HTTP 通路**（`GET /v1/sessions/current`）。
 * 当前会话指针是**进程内存**字段，删除只在"执行删除的那个进程"内复位 ⇒ 当会话被
 * 另一个进程/实例软删除（目录 rename 到 `.trash`）后，本进程指针仍指向它。
 * 故返回前必须校验**持久层**是否仍存在，失效即按"无当前会话"返回 `undefined`。
 */

import { describe, it, expect } from 'bun:test';
import { CoreAPIImpl } from '../../src/runtime/api/CoreAPIImpl.js';

type CoreAPIOptions = NonNullable<ConstructorParameters<typeof CoreAPIImpl>[0]>;
type ChatManagerLike = NonNullable<CoreAPIOptions['chatManager']>;

interface FakeSession {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{ role: string }>;
  metadata: Record<string, unknown>;
}

function mkSession(id: string): FakeSession {
  const at = new Date('2026-09-24T00:00:00Z');
  return {
    id,
    title: `title-${id}`,
    createdAt: at,
    updatedAt: at,
    messages: [{ role: 'user' }, { role: 'assistant' }],
    metadata: { marker: id },
  };
}

/**
 * @param inMemory 指针指向的内存会话（`null` = 无当前会话）
 * @param onDisk   持久层可解析到的会话（`null` = 已被外部进程删除）
 */
function makeFixture(inMemory: FakeSession | null, onDisk: FakeSession | null) {
  let gatewayGetCalls = 0;
  const chatManager = {
    getSessionManager: () => ({
      getCurrentSession: () => inMemory ?? undefined,
    }),
    getSessionGateway: () => ({
      getSession: async (id: string) => {
        gatewayGetCalls += 1;
        return onDisk && onDisk.id === id ? onDisk : null;
      },
    }),
  };
  const api = new CoreAPIImpl({
    chatManager: chatManager as unknown as ChatManagerLike,
  });
  return { api, gatewayGetCalls: () => gatewayGetCalls };
}

describe('CoreAPIImpl.getCurrentSession（TB-14）', () => {
  it('无当前会话（指针为空）⇒ 返回 undefined，且不查持久层', async () => {
    const { api, gatewayGetCalls } = makeFixture(null, null);
    expect(await api.getCurrentSession()).toBeUndefined();
    expect(gatewayGetCalls()).toBe(0);
  });

  it('指针指向的会话在持久层存在 ⇒ 返回完整 SessionInfo', async () => {
    const current = mkSession('sess-live');
    const { api, gatewayGetCalls } = makeFixture(
      current,
      mkSession('sess-live')
    );

    const info = await api.getCurrentSession();

    expect(info?.id).toBe('sess-live');
    expect(info?.title).toBe('title-sess-live');
    // 1 user + 1 assistant ⇒ 对话消息 2 条、轮次 1
    expect(info?.messageCount).toBe(2);
    expect(info?.roundCount).toBe(1);
    expect(info?.metadata).toEqual({ marker: 'sess-live' });
    expect(gatewayGetCalls()).toBe(1);
  });

  it('指针指向的会话已被外部进程删除 ⇒ 返回 undefined（不外泄幽灵 id）', async () => {
    // 内存 Map 里仍有（本进程未参与删除），但持久层已解析不到（目录被 rename 到 .trash）
    const ghost = mkSession('sess-ghost');
    const { api, gatewayGetCalls } = makeFixture(ghost, null);

    expect(await api.getCurrentSession()).toBeUndefined();
    expect(gatewayGetCalls()).toBe(1);
  });
});
