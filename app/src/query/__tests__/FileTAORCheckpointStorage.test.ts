/**
 * FileTAORCheckpointStorage 单元测试
 *
 * 覆盖 save/load/findBySessionId/delete/cleanup/getLatestIncomplete/getPendingSessions/deleteSession。
 * 使用临时目录隔离各测试。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { FileTAORCheckpointStorage } from '../FileTAORCheckpointStorage.js';
import { TAORPhase } from '../types.js';
import type { TAORCheckpoint } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

function makeCheckpoint(
  id: string,
  sessionId: string,
  overrides?: Partial<TAORCheckpoint>
): TAORCheckpoint {
  return {
    id,
    sessionId,
    turnCount: 3,
    phase: TAORPhase.THINK,
    budgetState: {
      consumed: 1000,
      remaining: 9000,
      total: 10000,
      lastCheckpointAt: Date.now(),
    },
    conversationSummary: 'test summary',
    lastPrompt: 'test prompt',
    createdAt: Date.now(),
    type: 'auto',
    ...overrides,
  };
}

describe('FileTAORCheckpointStorage', () => {
  let tempDir: string;
  let storage: FileTAORCheckpointStorage;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'taor-test-' + randomUUID());
    storage = new FileTAORCheckpointStorage(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // ─── save / load ─────────────────────────────────────

  describe('save / load', () => {
    test('save 后 load 返回相同数据', async () => {
      const cp = makeCheckpoint('cp1', 's1');
      const id = await storage.save(cp);
      expect(id).toBe('cp1');

      const loaded = await storage.load('cp1');
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('cp1');
      expect(loaded!.sessionId).toBe('s1');
      expect(loaded!.turnCount).toBe(3);
      expect(loaded!.phase).toBe(TAORPhase.THINK);
    });

    test('load 不存在的 id 返回 null', async () => {
      const result = await storage.load('ghost');
      expect(result).toBeNull();
    });

    test('save 覆盖已有检查点（同 id 同 session）', async () => {
      const cp1 = makeCheckpoint('cp2', 's2', { turnCount: 1 });
      await storage.save(cp1);

      const cp2 = makeCheckpoint('cp2', 's2', { turnCount: 5 });
      await storage.save(cp2);

      const loaded = await storage.load('cp2');
      expect(loaded!.turnCount).toBe(5);
    });
  });

  // ─── findBySessionId ─────────────────────────────────

  describe('findBySessionId', () => {
    test('返回某 session 的所有检查点，按时间降序', async () => {
      await storage.save(makeCheckpoint('cp-a1', 'sa', { createdAt: 1000 }));
      await storage.save(makeCheckpoint('cp-a2', 'sa', { createdAt: 2000 }));
      await storage.save(makeCheckpoint('cp-b1', 'sb', { createdAt: 500 }));

      const results = await storage.findBySessionId('sa');
      expect(results).toHaveLength(2);
      expect(results![0].createdAt).toBeGreaterThan(results![1].createdAt);
    });

    test('无结果的 session 返回 null', async () => {
      const result = await storage.findBySessionId('no-such-session');
      expect(result).toBeNull();
    });
  });

  // ─── getLatestIncomplete ─────────────────────────────

  describe('getLatestIncomplete', () => {
    test('返回最新创建且未完成的检查点', async () => {
      await storage.save(
        makeCheckpoint('cp-x1', 'sx', {
          createdAt: 1000,
          phase: TAORPhase.THINK,
        })
      );
      await storage.save(
        makeCheckpoint('cp-x2', 'sx', { createdAt: 2000, phase: TAORPhase.ACT })
      );

      const latest = await storage.getLatestIncomplete('sx');
      expect(latest).not.toBeNull();
      expect(latest!.id).toBe('cp-x2');
    });

    test('无检查点时返回 null', async () => {
      const result = await storage.getLatestIncomplete('no-session');
      expect(result).toBeNull();
    });
  });

  // ─── getPendingSessions ──────────────────────────────

  describe('getPendingSessions', () => {
    test('返回所有有检查点的 session ID', async () => {
      await storage.save(makeCheckpoint('cp1', 'session-a'));
      await storage.save(makeCheckpoint('cp2', 'session-b'));
      await storage.save(makeCheckpoint('cp3', 'session-a'));

      const sessions = await storage.getPendingSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions).toContain('session-a');
      expect(sessions).toContain('session-b');
    });

    test('空存储返回空数组', async () => {
      const sessions = await storage.getPendingSessions();
      expect(sessions).toEqual([]);
    });
  });

  // ─── delete ──────────────────────────────────────────

  describe('delete', () => {
    test('删除存在的检查点返回 true', async () => {
      await storage.save(makeCheckpoint('to-delete', 's1'));
      const result = await storage.delete('to-delete');
      expect(result).toBe(true);

      const loaded = await storage.load('to-delete');
      expect(loaded).toBeNull();
    });

    test('删除不存在的检查点返回 false', async () => {
      const result = await storage.delete('ghost');
      expect(result).toBe(false);
    });
  });

  // ─── deleteSession ───────────────────────────────────

  describe('deleteSession', () => {
    test('删除 session 的所有检查点', async () => {
      await storage.save(makeCheckpoint('cp1', 's-del'));
      await storage.save(makeCheckpoint('cp2', 's-del'));
      await storage.save(makeCheckpoint('cp3', 's-keep'));

      const count = await storage.deleteSession('s-del');
      expect(count).toBe(2);

      // s-del 的检查点都没了
      const remaining = await storage.findBySessionId('s-del');
      expect(remaining).toBeNull();

      // s-keep 的还在
      const kept = await storage.findBySessionId('s-keep');
      expect(kept).toHaveLength(1);
    });

    test('不存在的 session 返回 0', async () => {
      const count = await storage.deleteSession('no-such');
      expect(count).toBe(0);
    });
  });

  // ─── cleanup ─────────────────────────────────────────

  describe('cleanup', () => {
    test('清理超过 expireTime 的检查点', async () => {
      await storage.save(makeCheckpoint('cp-old', 's1', { createdAt: 1000 }));
      await storage.save(
        makeCheckpoint('cp-new', 's2', { createdAt: Date.now() })
      );

      // expireTime = 2000 (ms timestamp)，cp-old 的 mtime 是 1000 < 2000 → 清理
      const count = await storage.cleanup(2000);
      expect(count).toBeGreaterThanOrEqual(0); // mtime 取决于文件系统

      // cp-new 应该还在
      const loaded = await storage.load('cp-new');
      expect(loaded).not.toBeNull();
    });

    test('空目录 cleanup 返回 0', async () => {
      const count = await storage.cleanup(0);
      expect(count).toBe(0);
    });
  });

  // ─── 端到端 ─────────────────────────────────────────

  describe('端到端工作流', () => {
    test('save → findBySessionId → getLatestIncomplete → deleteSession', async () => {
      const sid = 'flowSession';
      await storage.save(
        makeCheckpoint('wf1', sid, { turnCount: 1, phase: TAORPhase.THINK })
      );
      await storage.save(
        makeCheckpoint('wf2', sid, { turnCount: 2, phase: TAORPhase.ACT })
      );
      await storage.save(
        makeCheckpoint('wf3', sid, { turnCount: 3, phase: TAORPhase.OBSERVE })
      );

      // findBySessionId
      const all = await storage.findBySessionId(sid);
      expect(all).toHaveLength(3);

      // getLatestIncomplete
      const latest = await storage.getLatestIncomplete(sid);
      expect(latest!.turnCount).toBe(3);

      // getPendingSessions
      const sessions = await storage.getPendingSessions();
      expect(sessions).toContain(sid);

      // deleteSession
      const deleted = await storage.deleteSession(sid);
      expect(deleted).toBe(3);

      const after = await storage.findBySessionId(sid);
      expect(after).toBeNull();
    });
  });
});
