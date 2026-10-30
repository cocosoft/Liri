// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// B1（2026-10-30）：事件流「相邻 thinking 合并」单测。
//
// 口径：同一 messageId 的**连续** thinking chunk 合并为一条事件；遇任意非 thinking 事件 /
// read / getTailSeq / flushTextBuffer / 超上限即落盘。事件类型、相对顺序、内容均不变。

import { describe, expect, it, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventLogStorage } from '../../src/session/storage/EventLogStorage';
import type { LiriEvent } from '@modules/session/types/events';

const HASH = 'default';
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

function makeStorage(
  sessionId: string,
  maxThinkingMergeBytes?: number
): EventLogStorage {
  const dir = mkdtempSync(join(tmpdir(), 'evtlog-thinking-'));
  createdDirs.push(dir);
  const sessionDir = join(dir, HASH, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  return maxThinkingMergeBytes === undefined
    ? new EventLogStorage(sessionId, HASH, dir)
    : new EventLogStorage(
        sessionId,
        HASH,
        dir,
        undefined,
        undefined,
        undefined,
        maxThinkingMergeBytes
      );
}

function thinking(messageId: string | undefined, content: string): LiriEvent {
  return {
    type: 'assistant/thinking',
    schemaVersion: 1,
    seq: 0,
    time: 1000,
    sessionId: 's',
    data: messageId === undefined ? { content } : { content, messageId },
  } as LiriEvent;
}

function turnEnd(turn: number): LiriEvent {
  return {
    type: 'turn/end',
    schemaVersion: 1,
    seq: 0,
    time: 2000,
    sessionId: 's',
    data: { turn, finishReason: 'stop' },
  } as LiriEvent;
}

function toolCall(messageId: string): LiriEvent {
  return {
    type: 'assistant/tool_call',
    schemaVersion: 1,
    seq: 0,
    time: 1500,
    sessionId: 's',
    data: { toolCallId: 'c1', name: 'read_file', args: {}, messageId },
  } as LiriEvent;
}

describe('B1 相邻 thinking 合并', () => {
  it('连续同 messageId 的 5 条 → 落盘 1 条，内容拼接、顺序不变', async () => {
    const s = makeStorage('merge-1');
    for (let i = 0; i < 5; i++) {
      expect((await s.append(thinking('m1', `t${i}`))).ok).toBe(true);
    }
    await s.append(turnEnd(1));

    const events = await s.read();
    expect(events.map((e) => e.type)).toEqual([
      'assistant/thinking',
      'turn/end',
    ]);
    expect((events[0].data as { content: string }).content).toBe('t0t1t2t3t4');
    expect((events[0].data as { messageId: string }).messageId).toBe('m1');
    // seq 在 flush 时分配，单调且被 turn/end 接续
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('被 tool_call 打断 → 两段各自合并，事件顺序与逐条写入一致', async () => {
    const s = makeStorage('merge-2');
    await s.append(thinking('m1', 'a'));
    await s.append(thinking('m1', 'b'));
    await s.append(toolCall('m1'));
    await s.append(thinking('m1', 'c'));
    await s.append(thinking('m1', 'd'));
    await s.append(turnEnd(1));

    const events = await s.read();
    expect(events.map((e) => e.type)).toEqual([
      'assistant/thinking',
      'assistant/tool_call',
      'assistant/thinking',
      'turn/end',
    ]);
    expect((events[0].data as { content: string }).content).toBe('ab');
    expect((events[2].data as { content: string }).content).toBe('cd');
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });

  it('不同 messageId 相邻 → 各成一条（不跨消息合并）', async () => {
    const s = makeStorage('merge-3');
    await s.append(thinking('m1', 'x'));
    await s.append(thinking('m2', 'y'));
    await s.append(turnEnd(1));

    const events = await s.read();
    expect(events).toHaveLength(3);
    expect((events[0].data as { messageId: string }).messageId).toBe('m1');
    expect((events[1].data as { messageId: string }).messageId).toBe('m2');
  });

  it('无 messageId 的 thinking 不合并（无法证明归属 ⇒ 逐条落盘）', async () => {
    const s = makeStorage('merge-4');
    await s.append(thinking(undefined, 'p'));
    await s.append(thinking(undefined, 'q'));
    await s.append(turnEnd(1));

    const events = await s.read();
    expect(events.map((e) => e.type)).toEqual([
      'assistant/thinking',
      'assistant/thinking',
      'turn/end',
    ]);
  });

  it('超过合并上限 ⇒ 立即落盘（分条数而非丢内容）', async () => {
    const s = makeStorage('merge-5', 10);
    await s.append(thinking('m1', 'aaaaaa')); // 6
    await s.append(thinking('m1', 'bbbbbb')); // 12 ≥ 10 ⇒ flush
    await s.append(thinking('m1', 'cc')); // 新一段
    await s.append(turnEnd(1));

    const events = await s.read();
    expect(events.map((e) => e.type)).toEqual([
      'assistant/thinking',
      'assistant/thinking',
      'turn/end',
    ]);
    expect((events[0].data as { content: string }).content).toBe(
      'aaaaaabbbbbb'
    );
    expect((events[1].data as { content: string }).content).toBe('cc');
  });

  it('read / getTailSeq 前自动落盘（缓冲不隐身）', async () => {
    const s = makeStorage('merge-6');
    await s.append(thinking('m1', 'abc'));
    await s.append(thinking('m1', 'def'));

    // read 触发 flush ⇒ 能读到已"写入"的思考
    const events = await s.read();
    expect(events).toHaveLength(1);
    expect((events[0].data as { content: string }).content).toBe('abcdef');
    expect(await s.getTailSeq()).toBe(1);
  });

  it('flushTextBuffer（消息末既有 flush 点）顺带落盘 thinking', async () => {
    const s = makeStorage('merge-7');
    await s.append(thinking('m1', 'zz'));
    expect(existsSync(s.getFilePath())).toBe(false);
    await s.flushTextBuffer();

    const raw = readFileSync(join(s.getFilePath()), 'utf-8')
      .split('\n')
      .filter((l) => l.trim());
    expect(raw).toHaveLength(1);
    expect(JSON.parse(raw[0]).type).toBe('assistant/thinking');
  });

  it('未 flush 时不落盘（真的减少了文件行数）', async () => {
    const s = makeStorage('merge-8');
    await s.append(thinking('m1', 'a'));
    await s.append(thinking('m1', 'b'));
    // 未触发任何 flush 点 ⇒ 磁盘上还没有该事件
    expect(existsSync(s.getFilePath())).toBe(false);
  });
});
