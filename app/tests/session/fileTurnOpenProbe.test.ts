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
 * 崩溃恢复的**默认轮次探针**（2026-11-25）。
 *
 * 现场：探针此前只由 `ChatManager` 注入，`SessionsTool` / `CombinedSessionGateway` / CLI 等
 * 自建网关仍按旧口径判定 ⇒ 把轮次早已闭合的会话反复标 `failed_stale`（人工复位被标回 ERROR）。
 * 本文件锁住默认探针（读 `events.jsonl` 尾部）的判定口径。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { createFileTurnOpenProbe } from '@modules/session';

const HASH = 'probehash';
const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
});

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'turn-probe-'));
  createdDirs.push(dir);
  return dir;
}

function writeEvents(
  sessionsRoot: string,
  sessionId: string,
  rows: Array<{ type: string; data: Record<string, unknown> }>
): void {
  const dir = join(sessionsRoot, HASH, sessionId);
  mkdirSync(dir, { recursive: true });
  const lines = rows.map((row, index) =>
    JSON.stringify({
      type: row.type,
      schemaVersion: 1,
      seq: index + 1,
      time: 1_700_000_000_000 + index * 1000,
      sessionId,
      data: row.data,
    })
  );
  writeFileSync(join(dir, 'events.jsonl'), lines.join('\n') + '\n', 'utf-8');
}

function probeFor(sessionsRoot: string) {
  return createFileTurnOpenProbe({ sessionsRoot, worktreeHash: HASH });
}

describe('createFileTurnOpenProbe（网关默认接线）', () => {
  it('真实 turn/end 收尾 ⇒ 已闭合（false）', async () => {
    const root = makeRoot();
    writeEvents(root, 'closed', [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'turn/end', data: { turn: 1, finishReason: 'stop' } },
    ]);
    expect(await probeFor(root)('closed')).toBe(false);
  });

  it('只有合成 closer（synthetic=true）⇒ 仍判未闭合（true）', async () => {
    const root = makeRoot();
    writeEvents(root, 'synthetic', [
      { type: 'turn/start', data: { turn: 2 } },
      {
        type: 'turn/end',
        data: { turn: 2, finishReason: 'canceled', synthetic: true },
      },
    ]);
    expect(await probeFor(root)('synthetic')).toBe(true);
  });

  it('只有 turn/start ⇒ 未闭合（true）', async () => {
    const root = makeRoot();
    writeEvents(root, 'open', [{ type: 'turn/start', data: { turn: 1 } }]);
    expect(await probeFor(root)('open')).toBe(true);
  });

  it('事件日志缺失 ⇒ 判已闭合（false，不产出假失败徽标）', async () => {
    const root = makeRoot();
    expect(await probeFor(root)('missing')).toBe(false);
  });

  it('复位写入的 reset_by_user closer ⇒ 已闭合（false）', async () => {
    const root = makeRoot();
    writeEvents(root, 'reset', [
      { type: 'turn/start', data: { turn: 3 } },
      { type: 'turn/end', data: { turn: 3, finishReason: 'reset_by_user' } },
    ]);
    expect(await probeFor(root)('reset')).toBe(false);
  });
});
