// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-26（长程真机取证）：`EventLogStorage.scanTailForMaxSeq` 的尾部扫描窗口。
 *
 * 缺陷：固定读末尾 64KB。当**最后一条事件本身 > 64KB**（真实数据：`context/model-input`
 * 单条 107,993 字节，含 77 个工具 schema）时，窗口整段落在该行的中间 ⇒ 解析不出任何事件
 * ⇒ `maxSeq` 恒为 0 ⇒ 与 `tailSeq` 比较判 `disk-behind`（"文件被外部截断"，与事实不符）：
 * 每次读事件都作废快照 + 回退全量扫盘 + 刷 warn（实测 `snapshotTailSeq === memoryTailSeq`
 * 仍报 `disk-behind` 共 9 条）。
 *
 * 本用例锁：超大事件在尾部时，扫描仍能取到真实尾 seq。
 */

import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLogStorage } from '@modules/session/storage/EventLogStorage';
import type { LiriEvent } from '@modules/session/types/events';

const HASH = 'hash-tail-scan';

interface TestableTailScan {
  scanTailForMaxSeq: () => Promise<number>;
  /** 私有字段：仅本用例用（与扫描结果对照） */
  tailSeq: number;
}

function makeStorage(sessionId: string): {
  storage: EventLogStorage;
  dir: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'evtlog-tailscan-'));
  // 与生产时序一致：会话目录由上层预建
  mkdirSync(join(dir, HASH, sessionId), { recursive: true });
  return { storage: new EventLogStorage(sessionId, HASH, dir), dir };
}

function ev(seq: number, content: string): LiriEvent {
  return {
    type: 'user/message' as never,
    schemaVersion: 1,
    seq,
    time: 1_700_000_000_000 + seq,
    sessionId: 's1',
    data: { content, messageId: `m${seq}` } as never,
  };
}

describe('scanTailForMaxSeq：单条超大事件不丢尾（2026-11-26）', () => {
  it('最后一条事件 120KB（> 64KB 窗口）⇒ 仍返回真实尾 seq', async () => {
    const { storage, dir } = makeStorage('sess-tail-big');
    try {
      await storage.append(ev(0, 'small'));
      await storage.append(ev(0, 'x'.repeat(120_000)));
      const probe = storage as unknown as TestableTailScan;
      expect(await probe.scanTailForMaxSeq()).toBe(probe.tailSeq);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('常规小事件（回归护栏）⇒ 仍按尾窗口取最大 seq', async () => {
    const { storage, dir } = makeStorage('sess-tail-small');
    try {
      for (let i = 0; i < 5; i += 1) await storage.append(ev(0, `第${i}条`));
      const probe = storage as unknown as TestableTailScan;
      expect(await probe.scanTailForMaxSeq()).toBe(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
