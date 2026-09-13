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
 * D3（2026-08-24）：事件级 fork —— SessionGateway.forkSession 单测
 *
 * 通过 storageConfig.basePath 指向临时目录，EventLogStorage 从该 basePath 派生
 * 会话路径（forkSession 内 sessionsRoot 派生逻辑），实现存储与事件路径统一：
 *  - 正常 fork：血缘 metadata（parentSessionId/seedLength）+ 前缀事件复制 + tailSeq
 *  - boundary 落在 open turn 内 → 拒绝
 *  - boundary 无效（0 / 超界）→ 拒绝
 *  - 源会话不存在 → 拒绝
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SessionGateway } from '../SessionGateway';
import { StorageType } from '../storage/UnifiedStorage';
import { EventLogStorage } from '../storage/EventLogStorage';
import type { LiriEvent } from '@modules/chat/types/events';

/** 构造一个 LiriEvent */
function ev(
  seq: number,
  type: LiriEvent['type'],
  data: Record<string, unknown>
): LiriEvent {
  return {
    type,
    seq,
    time: 1000 + seq,
    sessionId: 'fork-test',
    data,
  } as LiriEvent;
}

describe('SessionGateway.forkSession（D3-3）', () => {
  let root: string;
  let sessionsRoot: string;
  let basePath: string;
  let gateway: SessionGateway;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'session-fork-'));
    sessionsRoot = join(root, 'sessions');
    basePath = join(sessionsRoot, 'default');
    gateway = new SessionGateway({
      storageConfig: { type: StorageType.FILESYSTEM, basePath },
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** 在统一路径下构造源会话事件日志并写入事件 */
  async function seedSourceEvents(
    sourceId: string,
    events: LiriEvent[]
  ): Promise<void> {
    const log = new EventLogStorage(sourceId, 'default', sessionsRoot);
    for (const e of events) {
      const result = await log.append(e);
      expect(result.ok).toBe(true);
    }
  }

  it('正常 fork：血缘 metadata + 前缀事件复制 + 子会话可继续 append', async () => {
    const source = await gateway.createSession({ id: 'src', title: 'src' });
    await seedSourceEvents('src', [
      ev(1, 'user/message', { content: 'hi' }),
      ev(2, 'turn/start', { turn: 1 }),
      ev(3, 'assistant/text', { content: 'hello' }),
      ev(4, 'turn/end', { turn: 1, finishReason: 'stop' }),
      ev(5, 'user/message', { content: 'again' }),
    ]);

    const result = await gateway.forkSession('src', { childTitle: 'branch' });
    expect(result.success).toBe(true);
    const child = result.session!;
    expect(child.id).not.toBe('src');
    expect(child.metadata.parentSessionId).toBe('src');
    expect(child.metadata.seedLength).toBe(5);

    // 子会话事件文件 = 源前缀 [1..5]
    const childLog = new EventLogStorage(child.id, 'default', sessionsRoot);
    const events = await childLog.read();
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(events[0].data.content).toBe('hi');
    expect(await childLog.getTailSeq()).toBe(5);

    // 子会话可独立演进（seq 从 6 继续）
    const appended = await childLog.append(
      ev(6, 'user/message', { content: 'child-msg' })
    );
    expect(appended.ok).toBe(true);
  });

  it('指定 boundary：只复制 seq ≤ boundary 的前缀', async () => {
    await gateway.createSession({ id: 'src', title: 'src' });
    await seedSourceEvents('src', [
      ev(1, 'user/message', { content: 'a' }),
      ev(2, 'user/message', { content: 'b' }),
      ev(3, 'user/message', { content: 'c' }),
    ]);

    const result = await gateway.forkSession('src', {
      boundary: 2,
      childTitle: 'mid',
    });
    expect(result.success).toBe(true);
    const child = result.session!;
    expect(child.metadata.seedLength).toBe(2);

    const childLog = new EventLogStorage(child.id, 'default', sessionsRoot);
    const events = await childLog.read();
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('boundary 落在 open turn（未闭合 turn/start）内 → 拒绝', async () => {
    await gateway.createSession({ id: 'src', title: 'src' });
    await seedSourceEvents('src', [
      ev(1, 'user/message', { content: 'a' }),
      ev(2, 'turn/start', { turn: 1 }),
      ev(3, 'assistant/text', { content: 'thinking...' }),
      // 无 turn/end —— turn 未闭合
      ev(4, 'user/message', { content: 'b' }),
    ]);

    const result = await gateway.forkSession('src', { boundary: 4 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('open turn');

    // boundary 停在闭合边界（turn/start 之前）则允许
    const ok = await gateway.forkSession('src', { boundary: 1 });
    expect(ok.success).toBe(true);
  });

  it('boundary 无效（0 / 超界）→ 拒绝', async () => {
    await gateway.createSession({ id: 'src', title: 'src' });
    await seedSourceEvents('src', [ev(1, 'user/message', { content: 'a' })]);

    const zero = await gateway.forkSession('src', { boundary: 0 });
    expect(zero.success).toBe(false);
    expect(zero.error).toContain('invalid boundary');

    const over = await gateway.forkSession('src', { boundary: 99 });
    expect(over.success).toBe(false);
    expect(over.error).toContain('invalid boundary');
  });

  it('源会话不存在 → 拒绝', async () => {
    const result = await gateway.forkSession('missing-src');
    expect(result.success).toBe(false);
    expect(result.error).toContain('source session not found');
  });
});
