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
 * A1 临时对话隐身（2026-09-19）单元测试：
 * - 创建 temporary 会话 → listSessions 排除（不入历史列表），getSession 按 id 仍可恢复
 * - sendMessage → temporary 会话不进 FTS 索引（searchMessagesFTS 不可命中）
 * - 普通会话消息正常进 FTS（对照组）
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
// 复刻生产入口（main.ts）顺序：先求值 @modules/core barrel（完成 session 存储注册），
// 避免 StorageFactory → error → monitoring → core → session 循环 TDZ
import '@modules/core';
import { SessionGateway } from '../SessionGateway';
import { StorageType } from '../storage/UnifiedStorage';
import { getFTS5SearchEngine } from '../FTS5SearchEngine';
import { MessageType, MessageRole } from '../types/UnifiedMessage';
import type { UnifiedMessage } from '../types/UnifiedMessage';

function makeGateway(basePath: string): SessionGateway {
  return new SessionGateway({
    storageConfig: { type: StorageType.FILESYSTEM, basePath },
  });
}

function makeMessage(
  sessionId: string,
  id: string,
  content: string
): UnifiedMessage {
  return {
    id,
    sessionId,
    type: MessageType.USER,
    role: MessageRole.USER,
    content,
    timestamp: Date.now(),
  };
}

describe('A1 临时对话隐身（SessionGateway）', () => {
  let root: string;
  let gateway: SessionGateway;

  beforeEach(() => {
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    root = join(tmpdir(), `a1-temp-${tag}`);
    mkdirSync(root, { recursive: true });
    gateway = makeGateway(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('temporary 会话不出 listSessions，但 getSession 按 id 仍可恢复', async () => {
    const normal = await gateway.createSession({ title: '普通会话' });
    const temp = await gateway.createSession({
      title: '临时会话',
      metadata: { temporary: true },
    });

    const listed = await gateway.listSessions();
    expect(listed.some((s) => s.id === temp.id)).toBe(false);
    expect(listed.some((s) => s.id === normal.id)).toBe(true);

    const restored = await gateway.getSession(temp.id);
    expect(restored?.metadata?.temporary).toBe(true);
  });

  it('temporary 会话消息不进 FTS，普通会话消息正常进 FTS', async () => {
    const temp = await gateway.createSession({
      title: '临时会话',
      metadata: { temporary: true },
    });
    const normal = await gateway.createSession({ title: '普通会话' });

    const tag = `a1fts-${Math.random().toString(36).slice(2, 8)}`;
    await gateway.sendMessage(
      temp.id,
      makeMessage(temp.id, 'm-temp', `${tag} 临时消息不可搜索`)
    );
    await gateway.sendMessage(
      normal.id,
      makeMessage(normal.id, 'm-normal', `${tag} 普通消息可搜索`)
    );

    // 2026-09-29（D-12）两处修正：
    // ① `FTS5SearchEngine.search()` 自 09-28「FTS 索引按会话分片」起为 **async**
    //    （签名 `Promise<FTSSearchResult[]>`，见 FTS5SearchEngine.ts:229-232）⇒ 必须 await；
    //    此前同步调用拿到 Promise ⇒ `results.some is not a function`。
    // ② 同时把检索**限定到本用例的两个会话分片**（`sessionIds`，见 FTSSearchOptions:78-79）——
    //    否则会扇出全局索引（实测 157 片、3000ms 超时只扫到 40 片 ⇒ 断言随机失败）。
    //    本用例只关心"temp/normal 的消息有没有进索引"，限定作用域既确定又语义更准。
    const results = await getFTS5SearchEngine().search(tag, {
      sessionIds: [temp.id, normal.id],
    });
    const tempHit = results.some(
      (r) => r.document.metadata?.messageId === 'm-temp'
    );
    const normalHit = results.some(
      (r) => r.document.metadata?.messageId === 'm-normal'
    );
    expect(tempHit).toBe(false);
    expect(normalHit).toBe(true);
  });
});
