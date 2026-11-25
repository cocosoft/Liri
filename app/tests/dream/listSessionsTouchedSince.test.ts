/**
 * 修复回归（2026-11-25）：`listSessionsTouchedSince` 必须扫描**会话目录**而非把目录当文件读。
 *
 * 原实现 `readFile(resolveSessionsDir())` 恒抛错 ⇒ 恒 `[]` ⇒ AutoDream `minSessions` 门槛
 * 永不满足（自动梦永久空转，仅 manual `force` 可达）。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveSessionsDir } from '@openliri/infra/environment';
import { listSessionsTouchedSince } from '@openliri/infra/chronos/autoDream/ConsolidationLock';

const createdRoots: string[] = [];
const createdSessionIds: string[] = [];

function makeSessionDir(sessionId: string, files: string[]): string {
  const dir = join(resolveSessionsDir(), sessionId);
  mkdirSync(dir, { recursive: true });
  createdSessionIds.push(sessionId);
  for (const file of files) {
    writeFileSync(join(dir, file), '{}', 'utf-8');
  }
  return dir;
}

afterEach(() => {
  while (createdSessionIds.length > 0) {
    const id = createdSessionIds.pop();
    if (!id) continue;
    try {
      rmSync(join(resolveSessionsDir(), id), { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
  while (createdRoots.length > 0) {
    const root = createdRoots.pop();
    if (!root) continue;
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
});

describe('listSessionsTouchedSince（会话目录扫描）', () => {
  it('按活动文件 mtime 筛选；跳过 .trash/pid/空目录；兼容旧 <id>.json', async () => {
    const now = Date.now();
    const old = new Date(now - 3_600_000);

    const freshDir = makeSessionDir('sess_new', ['messages.jsonl']);
    const freshDir2 = makeSessionDir('sess_new2', ['session.json']);
    const oldDir = makeSessionDir('sess_old', ['session.json']);
    makeSessionDir('sess_empty', []);
    makeSessionDir('pid', ['1234']);
    makeSessionDir('.trash', ['gone']);

    utimesSync(join(oldDir, 'session.json'), old, old);
    // 新会话显式设为"现在"，避免文件系统时间粒度导致边界抖动
    utimesSync(join(freshDir, 'messages.jsonl'), new Date(now), new Date(now));
    utimesSync(join(freshDir2, 'session.json'), new Date(now), new Date(now));

    const legacyRoot = mkdtempSync(join(tmpdir(), 'legacy-session-'));
    createdRoots.push(legacyRoot);

    const ids = await listSessionsTouchedSince(now - 60_000);

    expect(ids).toContain('sess_new');
    expect(ids).toContain('sess_new2');
    expect(ids).not.toContain('sess_old');
    expect(ids).not.toContain('sess_empty');
    expect(ids).not.toContain('pid');
    expect(ids).not.toContain('.trash');
    // 排序稳定（便于 AutoDream 门槛/日志复算）
    expect(ids).toEqual([...ids].sort());
  });
});
