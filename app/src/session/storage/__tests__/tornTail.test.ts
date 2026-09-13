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
 * D4（2026-08-24）：torn-tail 崩溃修复 —— scanForTornTail / commitTornRepair 单测
 *
 * 通过临时目录 + 直接操作文件路径验证（不依赖沙箱写 ~/.pyapp）：
 *  - 完整文件 → 无 torn
 *  - 末尾半写行（无换行 + 截断 JSON）→ 检测 torn + 正确 offset
 *  - 末尾可解析但无换行 → torn（写盘未完成换行）
 *  - 截断后 tailSeq 正确恢复
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventLogStorage } from '../EventLogStorage';

/** 一行完整事件 JSON（含换行） */
function eventLine(seq: number): string {
  return (
    JSON.stringify({
      type: 'user/message',
      seq,
      time: 1000 + seq,
      sessionId: 'torn-test',
      data: { content: `msg-${seq}` },
    }) + '\n'
  );
}

/** 在临时目录构造 EventLogStorage，并覆盖 filePath 指向临时文件（绕过 ~/.pyapp 沙箱限制） */
function makeStorage(): {
  storage: EventLogStorage;
  dir: string;
  file: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'event-log-torn-'));
  const storage = new EventLogStorage('torn-test', 'torn-wt');
  const file = join(dir, 'events.jsonl');
  // 覆盖私有 filePath（exists/scan/truncate/getTailSeq 均读此路径）
  (storage as unknown as { filePath: string }).filePath = file;
  return { storage, dir, file };
}

describe('scanForTornTail（D4-1）', () => {
  it('完整文件（每行含换行）→ 无 torn', async () => {
    const { storage, dir, file } = makeStorage();
    try {
      writeFileSync(file, eventLine(1) + eventLine(2));
      const result = await storage.scanForTornTail();
      expect(result.torn).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('末尾半写行（无换行 + 截断 JSON）→ torn + offset 指向最后完整行末尾', async () => {
    const { storage, dir, file } = makeStorage();
    try {
      const complete = eventLine(1) + eventLine(2);
      writeFileSync(file, complete + '{"type":"user/message","seq":3');
      const result = await storage.scanForTornTail();
      expect(result.torn).toBe(true);
      expect(result.offset).toBe(complete.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('末尾可解析但无换行 → 保留（KB-TORN-PRESERVE：半写不可能 parse 成功，仅缺换行终止符）', async () => {
    const { storage, dir, file } = makeStorage();
    try {
      const complete = eventLine(1);
      const tailJson =
        '{"type":"user/message","seq":2,"time":1002,"sessionId":"torn-test","data":{"content":"x"}}';
      writeFileSync(file, complete + tailJson);
      const result = await storage.scanForTornTail();
      // 2026-08-29 KB-TORN-PRESERVE：可解析尾行 = JSON 内容完整（半写不可能 parse 成功），
      // 无换行仅缺 '\n' 终止符，非数据损坏 → 整条保留，不算 torn（不截断）。
      expect(result.torn).toBe(false);
      expect(result.offset).toBe(complete.length + tailJson.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('空文件 → 无 torn', async () => {
    const { storage, dir, file } = makeStorage();
    try {
      writeFileSync(file, '');
      const result = await storage.scanForTornTail();
      expect(result.torn).toBe(false);
      expect(result.offset).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('commitTornRepair（D4-2）', () => {
  it('检测到 torn → 截断成功 + tailSeq 恢复为最后完整 seq', async () => {
    const { storage, dir, file } = makeStorage();
    try {
      const complete = eventLine(1) + eventLine(2);
      writeFileSync(file, complete + '{"type":"user/message","seq":3');
      const ok = await storage.commitTornRepair();
      expect(ok).toBe(true);
      // 文件已截断为完整部分
      const content = readFileSync(file, 'utf-8');
      expect(content).toBe(complete);
      // tailSeq 恢复为 2
      const tail = await storage.getTailSeq(true);
      expect(tail).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('无 torn → 返回 false 且文件不变', async () => {
    const { storage, dir, file } = makeStorage();
    try {
      const complete = eventLine(1);
      writeFileSync(file, complete);
      const ok = await storage.commitTornRepair();
      expect(ok).toBe(false);
      expect(readFileSync(file, 'utf-8')).toBe(complete);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('interruptedTurnClosers（D4-3）', () => {
  /** 一行 turn/start 事件 */
  function turnStartLine(seq: number, turn: number): string {
    return (
      JSON.stringify({
        type: 'turn/start',
        seq,
        time: 1000 + seq,
        sessionId: 'torn-test',
        data: { turn },
      }) + '\n'
    );
  }

  /** 一行 turn/end 事件 */
  function turnEndLine(seq: number, turn: number): string {
    return (
      JSON.stringify({
        type: 'turn/end',
        seq,
        time: 1000 + seq,
        sessionId: 'torn-test',
        data: { turn, finishReason: 'stop' },
      }) + '\n'
    );
  }

  it('未闭合轮次 → 生成 closers（seq 连续、finishReason=canceled）', async () => {
    const { storage, dir, file } = makeStorage();
    try {
      // turn1 已闭合，turn2 未闭合（turn/start 无 turn/end）
      writeFileSync(
        file,
        turnStartLine(1, 1) +
          eventLine(2) +
          turnEndLine(3, 1) +
          turnStartLine(4, 2) +
          eventLine(5)
      );
      const { closers, openTurns } = await storage.interruptedTurnClosers();
      expect(openTurns).toEqual([2]);
      expect(closers.length).toBe(1);
      expect(closers[0].type).toBe('turn/end');
      expect(closers[0].seq).toBe(6); // tailSeq=5 → +1
      expect((closers[0].data as { turn: number }).turn).toBe(2);
      expect((closers[0].data as { finishReason: string }).finishReason).toBe(
        'canceled'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('全部轮次已闭合 → 无 closers', async () => {
    const { storage, dir, file } = makeStorage();
    try {
      writeFileSync(
        file,
        turnStartLine(1, 1) +
          eventLine(2) +
          turnEndLine(3, 1) +
          turnStartLine(4, 2) +
          eventLine(5) +
          turnEndLine(6, 2)
      );
      const { closers, openTurns } = await storage.interruptedTurnClosers();
      expect(openTurns).toEqual([]);
      expect(closers.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('commitInterruptedRepair 前置扫描 → closers 正确（落盘受沙箱限制不验证写入）', async () => {
    const { storage, dir, file } = makeStorage();
    try {
      writeFileSync(
        file,
        turnStartLine(1, 1) + eventLine(2) // turn1 未闭合
      );
      const { closers, openTurns } = await storage.interruptedTurnClosers();
      expect(openTurns).toEqual([1]);
      expect(closers.length).toBe(1);
      expect(closers[0].type).toBe('turn/end');
      expect(closers[0].seq).toBe(3); // tailSeq=2 → +1
      expect((closers[0].data as { turn: number }).turn).toBe(1);
      expect((closers[0].data as { finishReason: string }).finishReason).toBe(
        'canceled'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ensureRepairChecked（D4-4 首次 read 自动触发）', () => {
  it('首次 read 触发 torn 修复（半写行被清理）', async () => {
    const { storage, dir, file } = makeStorage();
    try {
      const complete = eventLine(1) + eventLine(2);
      // 半写行：最后一条 JSON 截断
      writeFileSync(file, complete + '{"type":"user/message","seq":3');
      // 首次 read → 自动修复：半写行被截断
      const events = await storage.read();
      expect(events.length).toBe(2);
      expect(events[0].seq).toBe(1);
      expect(events[1].seq).toBe(2);
      // 文件已截断（无半写残留）
      const content = readFileSync(file, 'utf-8');
      expect(content).toBe(complete);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('二次 read 不重复修复（幂等，无副作用）', async () => {
    const { storage, dir, file } = makeStorage();
    try {
      const complete = eventLine(1) + eventLine(2);
      writeFileSync(file, complete);
      await storage.read(); // 首次：触发修复（无 torn，无操作）
      const before = readFileSync(file, 'utf-8');
      await storage.read(); // 二次：_repairChecked=true，跳过修复
      expect(readFileSync(file, 'utf-8')).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('文件不存在时首次 read 安全（无修复、返回空）', async () => {
    const { storage, dir } = makeStorage();
    try {
      const events = await storage.read();
      expect(events).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
