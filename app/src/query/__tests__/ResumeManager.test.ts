/**
 * ResumeManager 单元测试
 *
 * 覆盖 scanPending/hasPending/getLatestCheckpoint/clearSession。
 * 使用临时目录隔离各测试。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { ResumeManager } from '../ResumeManager.js';
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

describe('ResumeManager', () => {
  let tempDir: string;
  let storage: FileTAORCheckpointStorage;
  let resumeManager: ResumeManager;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'resume-test-' + randomUUID());
    storage = new FileTAORCheckpointStorage(tempDir);
    resumeManager = new ResumeManager(storage);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // ─── scanPending ─────────────────────────────────────

  describe('scanPending', () => {
    test('无检查点时返回空数组', async () => {
      const candidates = await resumeManager.scanPending();
      expect(candidates).toEqual([]);
    });

    test('有未过期检查点时返回候选列表', async () => {
      await storage.save(
        makeCheckpoint('cp1', 's1', { turnCount: 1, type: 'auto' })
      );
      await storage.save(
        makeCheckpoint('cp2', 's2', { turnCount: 2, type: 'manual' })
      );

      const candidates = await resumeManager.scanPending();
      expect(candidates).toHaveLength(2);
      expect(candidates[0].sessionId).toBeDefined();
      expect(candidates[0].checkpoint).toBeDefined();
      expect(candidates[0].stopType).toBeDefined();
      expect(candidates[0].age).toBeGreaterThanOrEqual(0);
    });

    test('超过 24 小时的检查点被过滤', async () => {
      const oldTime = Date.now() - 25 * 60 * 60 * 1000; // 25 小时前
      await storage.save(
        makeCheckpoint('cpold', 'sold', { createdAt: oldTime, type: 'auto' })
      );
      await storage.save(makeCheckpoint('cpnew', 'snew', { type: 'auto' }));

      const candidates = await resumeManager.scanPending();
      expect(candidates).toHaveLength(1);
      expect(candidates[0].sessionId).toBe('snew');
    });

    test('返回的候选按 savedAt 降序排列', async () => {
      await storage.save(
        makeCheckpoint('cpA', 'sa', {
          createdAt: Date.now() - 5000,
          type: 'auto',
        })
      );
      await storage.save(
        makeCheckpoint('cpB', 'sb', { createdAt: Date.now(), type: 'manual' })
      );

      const candidates = await resumeManager.scanPending();
      expect(candidates[0].sessionId).toBe('sb');
    });

    test('同一 session 有多个检查点时只取最新的', async () => {
      await storage.save(
        makeCheckpoint('cp-old', 's1', {
          createdAt: Date.now() - 10000,
          turnCount: 1,
          type: 'auto',
        })
      );
      await storage.save(
        makeCheckpoint('cp-new', 's1', {
          createdAt: Date.now(),
          turnCount: 5,
          type: 'manual',
        })
      );

      const candidates = await resumeManager.scanPending();
      expect(candidates).toHaveLength(1);
      expect(candidates[0].checkpoint.turnCount).toBe(5);
    });
  });

  // ─── hasPending ──────────────────────────────────────

  describe('hasPending', () => {
    test('无检查点时返回 false', async () => {
      const result = await resumeManager.hasPending('no-session');
      expect(result).toBe(false);
    });

    test('有未过期检查点时返回 true', async () => {
      await storage.save(makeCheckpoint('cp1', 's1', { type: 'auto' }));
      const result = await resumeManager.hasPending('s1');
      expect(result).toBe(true);
    });

    test('超过 24 小时的检查点返回 false', async () => {
      const oldTime = Date.now() - 25 * 60 * 60 * 1000;
      await storage.save(
        makeCheckpoint('cp-old', 's-old', { createdAt: oldTime, type: 'auto' })
      );
      const result = await resumeManager.hasPending('s-old');
      expect(result).toBe(false);
    });
  });

  // ─── getLatestCheckpoint ─────────────────────────────

  describe('getLatestCheckpoint', () => {
    test('返回最新的检查点', async () => {
      await storage.save(
        makeCheckpoint('cp-1', 's1', { createdAt: 1000, turnCount: 1 })
      );
      await storage.save(
        makeCheckpoint('cp-2', 's1', { createdAt: 2000, turnCount: 2 })
      );

      const cp = await resumeManager.getLatestCheckpoint('s1');
      expect(cp).not.toBeNull();
      expect(cp!.id).toBe('cp-2');
      expect(cp!.turnCount).toBe(2);
    });

    test('无检查点时返回 null', async () => {
      const result = await resumeManager.getLatestCheckpoint('ghost');
      expect(result).toBeNull();
    });
  });

  // ─── clearSession ───────────────────────────────────

  describe('clearSession', () => {
    test('删除 session 的所有检查点', async () => {
      await storage.save(makeCheckpoint('cp1', 's-clear'));
      await storage.save(makeCheckpoint('cp2', 's-clear'));

      const count = await resumeManager.clearSession('s-clear');
      expect(count).toBe(2);

      // 确认删除
      const cp = await storage.getLatestIncomplete('s-clear');
      expect(cp).toBeNull();
    });

    test('不存在的 session 返回 0', async () => {
      const count = await resumeManager.clearSession('no-such');
      expect(count).toBe(0);
    });
  });

  // ─── 端到端 ─────────────────────────────────────────

  describe('端到端工作流', () => {
    test('保存检查点 → 扫描恢复 → 清除完成', async () => {
      const sid = 'e2eSession';

      // 1. 模拟任务执行中途保存检查点
      await storage.save(
        makeCheckpoint('e2e1', sid, {
          turnCount: 5,
          type: 'auto',
          phase: TAORPhase.ACT,
        })
      );

      // 2. 扫描
      const candidates = await resumeManager.scanPending();
      expect(candidates).toHaveLength(1);
      expect(candidates[0].sessionId).toBe(sid);
      expect(candidates[0].stopType).toBe('auto');

      // 3. hasPending
      expect(await resumeManager.hasPending(sid)).toBe(true);

      // 4. 获取最新检查点并恢复
      const cp = await resumeManager.getLatestCheckpoint(sid);
      expect(cp!.turnCount).toBe(5);

      // 5. 任务完成后清除
      await resumeManager.clearSession(sid);
      expect(await resumeManager.hasPending(sid)).toBe(false);
    });
  });
});
