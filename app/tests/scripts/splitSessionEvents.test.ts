/**
 * A（2026-10-30）：事件流按 seq 区间分片的单测。
 *
 * 覆盖：
 *  ① 切块口径（最后一块留活动尾文件）；
 *  ② 分片枚举按序号升序；
 *  ③ 预演只读 / `--apply` 后「分片升序 + 尾文件」拼接与原文**逐字节相同** + 备份 + 审计；
 *  ④ 切分删 `events.idx`、`events.tail` 保持最大 seq、已分片幂等；
 *  ⑤ **读路径守卫**：`read` 前后结果逐条相同（含深分页与命中尾文件的快路径）、
 *     `getTailSeq` 不变、切分后 append 仍续最大 seq 且落在活动尾文件。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  eventSegmentFileName,
  listEventSegmentsSync,
  planEventSplit,
} from '../../src/session/storage/eventSegments.js';
import {
  scanSessions,
  splitSessionEvents,
} from '../../scripts/split-session-events.js';
import { EventLogStorage } from '../../src/session/storage/EventLogStorage';
import type { LiriEvent } from '@modules/session/types/events';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-split-events-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 生成 `count` 条事件行（seq 1..count） */
function buildEvents(count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    JSON.stringify({
      seq: i + 1,
      type: 'user/message',
      schemaVersion: 1,
      time: 1_700_000_000_000 + i,
      sessionId: 's',
      data: { content: `m${i + 1}` },
    })
  );
}

/** 建会话目录（`partition` = EventLogStorage 的 worktreeHash） */
function makeSession(
  sessionId: string,
  lines: string[],
  options: { idx?: boolean } = {}
): string {
  const dir = join(root, 'sessions', 'default', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'), `${lines.join('\n')}\n`, 'utf-8');
  if (options.idx !== false) {
    writeFileSync(join(dir, 'events.idx'), '{"fromSeq":1}\n', 'utf-8');
  }
  writeFileSync(join(dir, 'events.tail'), String(lines.length), 'utf-8');
  return dir;
}

const readLines = (filePath: string): string[] =>
  readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0);

describe('planEventSplit（切块口径）', () => {
  it('按行数切块，最后一块留作活动尾文件', () => {
    const plan = planEventSplit(new Array(10).fill(1), {
      maxLines: 3,
      maxBytes: 10_000,
    });
    expect(plan.chunks).toEqual([
      { from: 0, to: 3 },
      { from: 3, to: 6 },
      { from: 6, to: 9 },
      { from: 9, to: 10 },
    ]);
    expect(plan.segments).toBe(3);
  });

  it('单块 / 空输入 ⇒ 不切', () => {
    expect(planEventSplit([]).segments).toBe(0);
    expect(planEventSplit([1, 1], { maxLines: 10 }).segments).toBe(0);
  });
});

describe('listEventSegmentsSync（读侧枚举）', () => {
  it('只认 events.<序号>.jsonl 并按序号升序（尾文件不在列表内）', () => {
    const dir = makeSession('sess_enum', buildEvents(1));
    writeFileSync(join(dir, 'events.0010.jsonl'), '\n', 'utf-8');
    writeFileSync(join(dir, 'events.0002.jsonl'), '\n', 'utf-8');
    writeFileSync(join(dir, 'events.bak.jsonl'), '\n', 'utf-8');
    expect(listEventSegmentsSync(dir)).toEqual([
      'events.0002.jsonl',
      'events.0010.jsonl',
    ]);
    expect(listEventSegmentsSync(join(dir, 'nope'))).toEqual([]);
  });
});

describe('splitSessionEvents（预演 / 应用 / 跳过判据）', () => {
  it('预演只读：给出计划但不写任何文件', () => {
    const dir = makeSession('sess_big', buildEvents(30));
    const before = readdirSync(dir).sort();

    const result = splitSessionEvents(root, { apply: false, maxLines: 10 });
    const item = result.items.find((i) => i.sessionId === 'sess_big');
    expect(item?.status).toBe('ok');
    expect(item?.segments).toBe(2);
    expect(result.applied).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(before);
  });

  it('--apply：拼接逐字节等于原文 + 删 idx + tail 不变 + 备份 + 审计', () => {
    const dir = makeSession('sess_big', buildEvents(30));
    const original = readFileSync(join(dir, 'events.jsonl'), 'utf-8');

    const result = splitSessionEvents(root, {
      apply: true,
      maxLines: 10,
      now: new Date('2026-10-30T12:00:00Z'),
    });
    expect(result.applied).toBe(1);

    expect(readdirSync(dir).sort()).toEqual([
      'events.0001.jsonl',
      'events.0002.jsonl',
      'events.jsonl',
      'events.tail',
    ]);
    const joined = [
      readFileSync(join(dir, eventSegmentFileName(1)), 'utf-8'),
      readFileSync(join(dir, eventSegmentFileName(2)), 'utf-8'),
      readFileSync(join(dir, 'events.jsonl'), 'utf-8'),
    ].join('');
    expect(joined).toBe(original);
    expect(readFileSync(join(dir, 'events.tail'), 'utf-8')).toBe('30');

    const backup = join(
      root,
      'migrations',
      'events-split-20261030T120000',
      'sess_big',
      'events.jsonl'
    );
    expect(readFileSync(backup, 'utf-8')).toBe(original);
    const audit = readLines(
      join(root, 'migrations', 'events-split-20261030T120000', 'audit.jsonl')
    );
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0])).toMatchObject({
      sessionId: 'sess_big',
      lines: 30,
      segments: 2,
      tailLines: 10,
      maxSeq: 30,
    });
  });

  it('已分片 / 未超阈 ⇒ 跳过（幂等）', () => {
    const small = makeSession('sess_small', buildEvents(3));
    const done = makeSession('sess_done', buildEvents(30));
    writeFileSync(join(done, 'events.0001.jsonl'), '{"seq":1}\n', 'utf-8');

    const items = scanSessions(root, { maxLines: 10 });
    expect(items.find((i) => i.sessionId === 'sess_done')?.status).toBe(
      'already-split'
    );
    expect(items.find((i) => i.sessionId === 'sess_small')?.status).toBe(
      'small'
    );
    expect(existsSync(join(small, 'events.0002.jsonl'))).toBe(false);
  });
});

describe('A 读路径守卫（EventLogStorage 分片兼容）', () => {
  const sessionId = 'sess_read';

  function makeStorage(): EventLogStorage {
    // 第三个参数是 **sessions 根**（脚本布局 `<root>/sessions/<partition>/<id>`）
    return new EventLogStorage(sessionId, 'default', join(root, 'sessions'));
  }

  it('read / getTailSeq 在切分前后逐条相同；切分后 append 续最大 seq', async () => {
    const lines = buildEvents(30);
    makeSession(sessionId, lines);

    const before = await makeStorage().read({ limit: 10_000 });
    expect(before).toHaveLength(30);

    splitSessionEvents(root, { apply: true, maxLines: 10 });
    // 新实例模拟"重启后读"（不复用任何内存缓存）
    const storage = makeStorage();

    // 全量读（走快照/多文件路径）
    const all = await storage.read({ limit: 10_000 });
    expect(all.length).toBe(30);
    expect(all.map((e: LiriEvent) => e.seq)).toEqual(before.map((e) => e.seq));
    expect(all.map((e) => e.data)).toEqual(before.map((e) => e.data));

    // 深分页（fromSeq 落在**分片**内 ⇒ 多文件逐行扫描）
    const deep = await storage.read({ fromSeq: 15, limit: 5 });
    expect(deep.map((e) => e.seq)).toEqual([15, 16, 17, 18, 19]);

    // fromSeq 落在**尾文件**内（21..30）⇒ 尾文件快路径
    const tailOnly = await storage.read({ fromSeq: 25, limit: 100 });
    expect(tailOnly.map((e) => e.seq)).toEqual([25, 26, 27, 28, 29, 30]);

    // tailSeq 不变
    expect(await storage.getTailSeq()).toBe(30);

    // append 续最大 seq，且写入活动尾文件（分片保持不可变）
    const appended = await storage.append({
      type: 'user/message',
      schemaVersion: 1,
      seq: 0,
      time: Date.now(),
      sessionId,
      data: { content: 'after-split' },
    } as LiriEvent);
    expect(appended.ok).toBe(true);
    expect(appended.tailSeq).toBe(31);
    const tailDir = join(root, 'sessions', 'default', sessionId);
    const tailLines = readLines(join(tailDir, 'events.jsonl'));
    expect(JSON.parse(tailLines[tailLines.length - 1]).seq).toBe(31);
    // 分片内容未被追加（不可变）
    expect(readLines(join(tailDir, eventSegmentFileName(1)))).toHaveLength(10);
    expect(readLines(join(tailDir, eventSegmentFileName(2)))).toHaveLength(10);
  });
});
