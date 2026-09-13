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
 * D3（2026-08-24）：事件级 fork —— EventLogStorage.copyPrefixTo 单测
 *
 * 通过临时目录 + 覆盖私有 filePath 验证（参照 tornTail.test.ts 模式，绕过沙箱）：
 *  - copyPrefixTo(M) 复制 seq ≤ M 的前缀事件（内容 + seq 范围）
 *  - boundary 超界 → 复制全量
 *  - 目标非空 → 拒绝 target-not-empty
 *  - 复制后子会话 tailSeq 同步，可继续 append seq=boundary+1
 *  - 源无事件文件 → ok, copied 0
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventLogStorage } from '../EventLogStorage';
import type { LiriEvent } from '@modules/chat/types/events';

/** 一行完整事件 JSON（含换行） */
function eventLine(seq: number): string {
  return (
    JSON.stringify({
      type: 'user/message',
      seq,
      time: 1000 + seq,
      sessionId: 'fork-test',
      data: { content: `msg-${seq}` },
    } as LiriEvent) + '\n'
  );
}

/** 在临时目录构造 EventLogStorage，并覆盖 filePath/tailSeqMetaPath 指向临时文件（绕过 ~/.pyapp 沙箱限制） */
function makeStorage(tag: string): {
  storage: EventLogStorage;
  dir: string;
  file: string;
} {
  const dir = mkdtempSync(join(tmpdir(), `event-log-${tag}-`));
  const storage = new EventLogStorage(tag, 'fork-wt');
  const file = join(dir, 'events.jsonl');
  // 覆盖私有路径字段（exists/getTailSeq/copyPrefixTo/writePersistedTailSeq 均读/写这些路径）
  const inner = storage as unknown as {
    filePath: string;
    tailSeqMetaPath: string;
  };
  inner.filePath = file;
  inner.tailSeqMetaPath = join(dir, 'events.tail');
  return { storage, dir, file };
}

describe('copyPrefixTo（D3-2）', () => {
  it('复制 seq ≤ boundary 的前缀事件，目标文件与源内容一致', async () => {
    const src = makeStorage('src');
    const dst = makeStorage('dst');
    try {
      writeFileSync(
        src.file,
        eventLine(1) + eventLine(2) + eventLine(3) + eventLine(4)
      );

      const result = await src.storage.copyPrefixTo(dst.storage, 3);
      expect(result.ok).toBe(true);
      expect(result.copied).toBe(3);

      // 目标文件恰好为源前缀（seq 1..3）
      const dstLines = readFileSync(dst.file, 'utf-8').trim().split('\n');
      expect(dstLines).toHaveLength(3);
      const dstEvents = dstLines.map((l) => JSON.parse(l) as LiriEvent);
      expect(dstEvents.map((e) => e.seq)).toEqual([1, 2, 3]);
      expect(dstEvents[0].data.content).toBe('msg-1');
      // 目标 tailSeq 同步为 3
      expect(await dst.storage.getTailSeq()).toBe(3);
    } finally {
      rmSync(src.dir, { recursive: true, force: true });
      rmSync(dst.dir, { recursive: true, force: true });
    }
  });

  it('boundary 超界 → 复制全量', async () => {
    const src = makeStorage('src');
    const dst = makeStorage('dst');
    try {
      writeFileSync(src.file, eventLine(1) + eventLine(2));

      const result = await src.storage.copyPrefixTo(dst.storage, 999);
      expect(result.ok).toBe(true);
      expect(result.copied).toBe(2);
      expect(await dst.storage.getTailSeq()).toBe(2);
    } finally {
      rmSync(src.dir, { recursive: true, force: true });
      rmSync(dst.dir, { recursive: true, force: true });
    }
  });

  it('目标已有事件 → 拒绝 target-not-empty，不改动目标文件', async () => {
    const src = makeStorage('src');
    const dst = makeStorage('dst');
    try {
      writeFileSync(src.file, eventLine(1) + eventLine(2));
      writeFileSync(dst.file, eventLine(7));

      const result = await src.storage.copyPrefixTo(dst.storage, 2);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('target-not-empty');
      // 目标文件未被改动
      expect(readFileSync(dst.file, 'utf-8')).toBe(eventLine(7));
    } finally {
      rmSync(src.dir, { recursive: true, force: true });
      rmSync(dst.dir, { recursive: true, force: true });
    }
  });

  it('复制后子会话可继续 append（seq 从 boundary+1 延续）', async () => {
    const src = makeStorage('src');
    const dst = makeStorage('dst');
    try {
      writeFileSync(src.file, eventLine(1) + eventLine(2));

      await src.storage.copyPrefixTo(dst.storage, 2);
      const appended = await dst.storage.append({
        type: 'user/message',
        seq: 3,
        time: 2000,
        sessionId: 'fork-test',
        data: { content: 'child-msg' },
      } as LiriEvent);
      expect(appended.ok).toBe(true);

      const events = await dst.storage.read();
      expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
      expect(events[2].data.content).toBe('child-msg');
    } finally {
      rmSync(src.dir, { recursive: true, force: true });
      rmSync(dst.dir, { recursive: true, force: true });
    }
  });

  it('源无事件文件 → ok, copied 0', async () => {
    const src = makeStorage('src');
    const dst = makeStorage('dst');
    try {
      const result = await src.storage.copyPrefixTo(dst.storage, 5);
      expect(result.ok).toBe(true);
      expect(result.copied).toBe(0);
      expect(await dst.storage.getTailSeq()).toBe(0);
    } finally {
      rmSync(src.dir, { recursive: true, force: true });
      rmSync(dst.dir, { recursive: true, force: true });
    }
  });
});
