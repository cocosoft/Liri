/**
 * M6（2026-10-31）：幽灵 / 空会话清理的单测。
 *
 * 覆盖：分类口径（有内容 / 近期 / 候选）、预演只读、软删除到分区 `.trash`
 * （与 `deleteSession` 同款命名）、备份 + 审计、幂等。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  pruneEmptySessions,
  scanEmptySessions,
} from '../../scripts/prune-empty-sessions.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-empty-sessions-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 建一个会话目录；`idleHours` 拨旧目录 mtime */
function makeSession(
  sessionId: string,
  options: {
    idleHours?: number;
    messages?: number;
    events?: number;
    meta?: Record<string, unknown> | null;
    extraFiles?: string[];
  } = {}
): string {
  const dir = join(root, 'sessions', 'p1', sessionId);
  mkdirSync(dir, { recursive: true });
  if (options.meta !== null) {
    writeFileSync(
      join(dir, 'session.json'),
      JSON.stringify(options.meta ?? { title: sessionId, status: 'active' }),
      'utf-8'
    );
  }
  const line = (i: number, type: string) =>
    JSON.stringify({ seq: i, type, data: {} });
  if (options.messages) {
    writeFileSync(
      join(dir, 'messages.jsonl'),
      `${Array.from({ length: options.messages }, (_, i) => JSON.stringify({ id: `m${i}` })).join('\n')}\n`,
      'utf-8'
    );
  }
  if (options.events) {
    writeFileSync(
      join(dir, 'events.jsonl'),
      `${Array.from({ length: options.events }, (_, i) => line(i + 1, 'user/message')).join('\n')}\n`,
      'utf-8'
    );
  }
  for (const name of options.extraFiles ?? []) {
    writeFileSync(join(dir, name), 'x', 'utf-8');
  }
  if (options.idleHours !== undefined) {
    const t = Date.now() - options.idleHours * 3_600_000;
    utimesSync(dir, new Date(t), new Date(t));
  }
  return dir;
}

describe('scanEmptySessions（分类口径）', () => {
  it('0 消息 0 事件 且空闲超阈 ⇒ 候选；有内容 / 近期写入 ⇒ 跳过', () => {
    makeSession('empty_old', { idleHours: 48 });
    makeSession('empty_recent', { idleHours: 0 });
    makeSession('with_msgs', { idleHours: 48, messages: 3 });
    makeSession('with_events', { idleHours: 48, events: 2 });
    makeSession('with_artifact', { idleHours: 48, extraFiles: ['memory.md'] });

    const items = scanEmptySessions(root, { minIdleHours: 24 });
    const byId = new Map(items.map((i) => [i.sessionId, i]));
    expect(byId.get('empty_old')?.status).toBe('empty');
    expect(byId.get('empty_recent')?.status).toBe('recent');
    expect(byId.get('with_msgs')?.status).toBe('has-data');
    expect(byId.get('with_events')?.status).toBe('has-data');
    expect(byId.get('with_artifact')?.status).toBe('has-data');
  });

  it('会话锁目录 `pid` 不是幽灵会话 ⇒ 永不进候选', () => {
    makeSession('pid', { idleHours: 30, meta: null });
    const ids = scanEmptySessions(root, { minIdleHours: 0 }).map(
      (i) => i.sessionId
    );
    expect(ids).not.toContain('pid');
  });

  it('events.tail / events.idx 不算产物（空会话的正常落盘形态）', () => {
    makeSession('empty_with_meta_files', {
      idleHours: 30,
      extraFiles: ['events.tail', 'events.idx'],
    });
    const item = scanEmptySessions(root, { minIdleHours: 24 }).find(
      (i) => i.sessionId === 'empty_with_meta_files'
    );
    expect(item?.status).toBe('empty');
    expect(item?.otherFiles).toEqual([]);
  });

  it('跳过 .trash 等点目录', () => {
    const trash = join(root, 'sessions', 'p1', '.trash', 'x_1');
    mkdirSync(trash, { recursive: true });
    const ids = scanEmptySessions(root, { minIdleHours: 0 }).map(
      (i) => i.sessionId
    );
    expect(ids).not.toContain('.trash');
    expect(ids).not.toContain('x_1');
  });
});

describe('pruneEmptySessions（预演 / 软删除 / 备份审计）', () => {
  it('预演：不移动任何目录、不建备份', () => {
    const dir = makeSession('empty_old', { idleHours: 48 });
    const result = pruneEmptySessions(root, { apply: false, minIdleHours: 24 });
    expect(result.items.find((i) => i.sessionId === 'empty_old')?.status).toBe(
      'empty'
    );
    expect(result.applied).toBe(0);
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(join(root, 'migrations'))).toBe(false);
  });

  it('--apply：移入分区 .trash（同 deleteSession 命名）+ 备份 session.json + 审计', () => {
    makeSession('empty_old', {
      idleHours: 48,
      meta: { title: '默认会话', status: 'active' },
    });
    makeSession('empty_recent', { idleHours: 0 });
    makeSession('with_msgs', { idleHours: 48, messages: 2 });
    const now = new Date('2026-10-31T10:00:00Z').getTime();

    const result = pruneEmptySessions(root, {
      apply: true,
      minIdleHours: 24,
      now,
    });
    expect(result.applied).toBe(1);
    expect(existsSync(join(root, 'sessions', 'p1', 'empty_old'))).toBe(false);
    expect(existsSync(join(root, 'sessions', 'p1', 'empty_recent'))).toBe(true);
    expect(existsSync(join(root, 'sessions', 'p1', 'with_msgs'))).toBe(true);

    const trashRoot = join(root, 'sessions', 'p1', '.trash');
    const trashed = readdirSync(trashRoot);
    expect(trashed).toEqual([`empty_old_${now}`]);
    // 软删除后目录内容完整保留（可在 TTL 内回滚）
    expect(
      readFileSync(join(trashRoot, trashed[0], 'session.json'), 'utf-8')
    ).toContain('默认会话');

    const backupDir = join(
      root,
      'migrations',
      'empty-sessions-20261031T100000'
    );
    expect(
      readFileSync(join(backupDir, 'empty_old', 'session.json'), 'utf-8')
    ).toContain('默认会话');
    const audit = readFileSync(join(backupDir, 'audit.jsonl'), 'utf-8')
      .split('\n')
      .filter((l) => l.trim());
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0])).toMatchObject({
      partition: 'p1',
      sessionId: 'empty_old',
      hasMeta: true,
      title: '默认会话',
    });
  });

  it('重复执行 ⇒ 幂等（已移走的目录不再出现）', () => {
    makeSession('empty_old', { idleHours: 48 });
    const first = pruneEmptySessions(root, { apply: true, minIdleHours: 24 });
    expect(first.applied).toBe(1);
    const second = pruneEmptySessions(root, { apply: true, minIdleHours: 24 });
    expect(second.applied).toBe(0);
  });
});
