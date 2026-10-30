// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `session-storage-audit`（#24，2026-10-30）
 *
 * 契约：
 * - 磁盘真源只认 `sessions/<partition>/<sessionId>/session.json`（没有 `session.json`
 *   的目录不算会话）；
 * - 派生视图（history / transcripts）与废弃目录（chat_sessions）只盘点、不评判；
 * - 超阈值文件（> 5 MB 的 messages.jsonl / events.jsonl）被如实列出；
 * - `formatAudit` 输出可读口径（CLI 与测试共用）。
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  OVERSIZE_BYTES,
  auditStorage,
  formatAudit,
  listSessionIdsOnDisk,
} from '../../scripts/session-storage-audit';

let root = '';

function mkSession(
  partition: string,
  id: string,
  sizes: { messages?: number; events?: number }
): void {
  const dir = join(root, 'sessions', partition, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'session.json'), JSON.stringify({ id }), 'utf8');
  if (sizes.messages !== undefined) {
    writeFileSync(
      join(dir, 'messages.jsonl'),
      Buffer.alloc(sizes.messages, 0x20)
    );
  }
  if (sizes.events !== undefined) {
    writeFileSync(join(dir, 'events.jsonl'), Buffer.alloc(sizes.events, 0x20));
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-storage-audit-'));
  mkSession('p1', 'session_a', { messages: 1024, events: 2048 });
  mkSession('p1', 'session_big', { messages: OVERSIZE_BYTES + 1, events: 10 });
  // 没有 session.json 的目录（如 .trash 残留）不算会话
  mkdirSync(join(root, 'sessions', 'p1', 'junk'), { recursive: true });

  mkdirSync(join(root, 'history', 'proj_1'), { recursive: true });
  mkdirSync(join(root, 'transcripts'), { recursive: true });
  writeFileSync(join(root, 'transcripts', 'session_a.jsonl'), '{}\n', 'utf8');
  mkdirSync(join(root, 'chat_sessions'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('listSessionIdsOnDisk', () => {
  test('只认带 session.json 的会话目录', () => {
    expect(listSessionIdsOnDisk(join(root, 'sessions'))).toEqual([
      'session_a',
      'session_big',
    ]);
  });

  test('目录不存在 ⇒ 空', () => {
    expect(listSessionIdsOnDisk(join(root, 'nope'))).toEqual([]);
  });
});

describe('auditStorage / formatAudit', () => {
  test('盘点真源 / 派生视图 / 废弃目录 / 超阈值文件', () => {
    const audit = auditStorage(root);

    expect(audit.sessionIds).toEqual(['session_a', 'session_big']);
    expect(audit.historyDirs).toBe(1);
    expect(audit.transcriptFiles).toBe(1);
    expect(audit.deadChatSessionsDir).toEqual({ exists: true, empty: true });
    expect(audit.oversize.map((o) => o.sessionId)).toEqual(['session_big']);
    expect(audit.oversize[0].messagesBytes).toBe(OVERSIZE_BYTES + 1);
  });

  test('文案包含关键口径（会话数 / 派生可重建 / 超阈值清单）', () => {
    const lines = formatAudit(auditStorage(root)).join('\n');
    expect(lines).toContain('会话真源');
    expect(lines).toContain('2 个');
    expect(lines).toContain('可删除后重建');
    expect(lines).toContain('session_big');
  });

  test('无废弃目录 / 无超阈值文件时如实说明', () => {
    rmSync(join(root, 'chat_sessions'), { recursive: true, force: true });
    rmSync(join(root, 'sessions', 'p1', 'session_big'), {
      recursive: true,
      force: true,
    });

    const audit = auditStorage(root);
    expect(audit.deadChatSessionsDir).toBeNull();
    expect(audit.oversize).toEqual([]);
    const lines = formatAudit(audit).join('\n');
    expect(lines).toContain('chat_sessions/：不存在');
    expect(lines).toContain('超过 5.0 MB 的会话文件：0');
  });
});
