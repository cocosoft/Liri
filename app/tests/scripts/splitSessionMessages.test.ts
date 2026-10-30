/**
 * M8（2026-10-30，一致性核查）：消息投影分片工具与读侧兼容的单测。
 *
 * 覆盖：
 *  ① 切块纯函数（行数/字节双约束；**最后一块留在活动尾文件**）；
 *  ② 预演只读（不写任何文件）；`--apply` 才写分片 + 备份 + 审计；
 *  ③ 三种"不切"判据：legacy（无 `events.jsonl`）/ 已分片 / 体积未超阈；
 *  ④ 读侧分片枚举按序号升序（`listMessageSegments`）。
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
  scanSessions,
  splitSessionMessages,
} from '../../scripts/split-session-messages.js';
import {
  listMessageSegments,
  planMessageSplit,
} from '../../src/session/storage/messageSegments.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-split-messages-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 建一个会话目录；`lines` 条消息行（每行 ~40 字节） */
function makeSession(
  sessionId: string,
  options: { lines: number; events?: boolean }
): string {
  const dir = join(root, 'sessions', 'partition1', sessionId);
  mkdirSync(dir, { recursive: true });
  if (options.events !== false) {
    writeFileSync(join(dir, 'events.jsonl'), '{"seq":1}\n', 'utf-8');
  }
  const rows = Array.from({ length: options.lines }, (_, i) =>
    JSON.stringify({ id: `m${i}`, role: 'user', content: 'x'.repeat(20) })
  );
  writeFileSync(join(dir, 'messages.jsonl'), `${rows.join('\n')}\n`, 'utf-8');
  return dir;
}

describe('planMessageSplit（M8 切块口径）', () => {
  it('按行数切块，最后一块留作尾文件', () => {
    const plan = planMessageSplit(new Array(10).fill(1), {
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

  it('按字节上限切块（行数未到也切）', () => {
    const plan = planMessageSplit(new Array(5).fill(100), {
      maxLines: 1000,
      maxBytes: 250,
    });
    expect(plan.chunks).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
      { from: 4, to: 5 },
    ]);
    expect(plan.segments).toBe(2);
  });

  it('空输入 / 单块 ⇒ 0 个分片（不切）', () => {
    expect(planMessageSplit([])).toEqual({ chunks: [], segments: 0 });
    expect(planMessageSplit([1, 1], { maxLines: 10 }).segments).toBe(0);
  });
});

describe('splitSessionMessages（M8 预演 / 应用 / 跳过判据）', () => {
  it('预演只读：给出计划但不写任何文件', () => {
    const dir = makeSession('sess_big', { lines: 9 });
    const before = readdirSync(dir).sort();

    const result = splitSessionMessages(root, { apply: false, maxLines: 3 });
    const item = result.items.find((i) => i.sessionId === 'sess_big');
    expect(item?.status).toBe('ok');
    expect(item?.segments).toBe(2);
    expect(result.applied).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(before);
  });

  it('--apply：切出有序分片 + 尾文件，并整份备份 + 审计', () => {
    const dir = makeSession('sess_big', { lines: 9 });
    const original = readFileSync(join(dir, 'messages.jsonl'), 'utf-8');

    const result = splitSessionMessages(root, {
      apply: true,
      maxLines: 3,
      now: new Date('2026-10-30T12:00:00Z'),
    });
    expect(result.applied).toBe(1);

    expect(readdirSync(dir).sort()).toEqual([
      'events.jsonl',
      'messages.0001.jsonl',
      'messages.0002.jsonl',
      'messages.jsonl',
    ]);
    const seg1 = readFileSync(join(dir, 'messages.0001.jsonl'), 'utf-8');
    const seg2 = readFileSync(join(dir, 'messages.0002.jsonl'), 'utf-8');
    const tail = readFileSync(join(dir, 'messages.jsonl'), 'utf-8');
    // 顺序拼接 === 原文件（未丢行、未乱序）
    expect(`${seg1}${seg2}${tail}`).toBe(original);
    expect(tail.trim().split('\n')).toHaveLength(3);

    const backup = join(
      root,
      'migrations',
      'messages-split-20261030T120000',
      'sess_big',
      'messages.jsonl'
    );
    expect(readFileSync(backup, 'utf-8')).toBe(original);
    const audit = readFileSync(
      join(root, 'migrations', 'messages-split-20261030T120000', 'audit.jsonl'),
      'utf-8'
    );
    expect(audit.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(audit.trim())).toMatchObject({
      sessionId: 'sess_big',
      segments: 2,
      tailLines: 3,
    });
  });

  it('legacy（无 events.jsonl）⇒ 跳过，不切分（迁移器只读尾段会丢数据）', () => {
    const dir = makeSession('sess_legacy', { lines: 9, events: false });
    const result = splitSessionMessages(root, { apply: true, maxLines: 3 });
    expect(
      result.items.find((i) => i.sessionId === 'sess_legacy')?.status
    ).toBe('no-events');
    expect(result.applied).toBe(0);
    expect(existsSync(join(dir, 'messages.0001.jsonl'))).toBe(false);
  });

  it('已分片 / 体积未超阈 ⇒ 不重复切分（幂等）', () => {
    const dir = makeSession('sess_done', { lines: 2 });
    writeFileSync(join(dir, 'messages.0001.jsonl'), '{"id":"old"}\n', 'utf-8');
    const small = makeSession('sess_small', { lines: 2 });

    const items = scanSessions(root, { maxLines: 1000 });
    expect(items.find((i) => i.sessionId === 'sess_done')?.status).toBe(
      'already-split'
    );
    expect(items.find((i) => i.sessionId === 'sess_small')?.status).toBe(
      'small'
    );
    expect(existsSync(join(small, 'messages.0002.jsonl'))).toBe(false);
  });
});

describe('listMessageSegments（M8 读侧分片枚举）', () => {
  it('只认 messages.<序号>.jsonl 并按序号升序（尾文件不在列表内）', async () => {
    const dir = makeSession('sess_seg', { lines: 1 });
    writeFileSync(join(dir, 'messages.0010.jsonl'), '\n', 'utf-8');
    writeFileSync(join(dir, 'messages.0002.jsonl'), '\n', 'utf-8');
    writeFileSync(join(dir, 'messages.bak.jsonl'), '\n', 'utf-8');

    expect(await listMessageSegments(dir)).toEqual([
      'messages.0002.jsonl',
      'messages.0010.jsonl',
    ]);
    // 目录不存在 ⇒ 空（不抛错）
    expect(await listMessageSegments(join(dir, 'nope'))).toEqual([]);
  });
});
