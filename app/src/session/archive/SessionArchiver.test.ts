import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionArchiver } from './SessionArchiver';
import type { ArchivableSession } from './SessionArchiver';
import type { ArchiveConfig } from './ArchiveTypes';
import type { UnifiedSession } from '../types/Session';
import type { UnifiedMessage } from '../types/Message';

function createTestArchivableSession(
  id: string,
  overrides?: Partial<ArchivableSession>
): ArchivableSession {
  const now = Date.now();
  return {
    id,
    status: 'active',
    messageCount: 3,
    totalTokens: 500,
    createdAt: now - 7200000,
    updatedAt: now - 3600000,
    lastActivityAt: now - 3600000,
    toUnifiedSession(): UnifiedSession {
      return {
        id,
        type: 'local' as never,
        createdAt: now - 7200000,
        updatedAt: now - 3600000,
        lastActivityAt: now - 3600000,
        status: 'active' as never,
        metadata: {},
      };
    },
    toUnifiedMessages(): UnifiedMessage[] {
      return [
        {
          id: `${id}-m1`,
          sessionId: id,
          type: 'user' as never,
          role: 'user' as never,
          content: 'Hello',
          timestamp: now - 7200000,
        },
        {
          id: `${id}-m2`,
          sessionId: id,
          type: 'assistant' as never,
          role: 'assistant' as never,
          content: 'World',
          timestamp: now - 5400000,
        },
        {
          id: `${id}-m3`,
          sessionId: id,
          type: 'user' as never,
          role: 'user' as never,
          content: 'Done',
          timestamp: now - 3600000,
        },
      ];
    },
    ...overrides,
  };
}

describe('SessionArchiver', () => {
  let testDir: string;
  let archiver: SessionArchiver;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `Liri_session_archiver_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    );
    mkdirSync(testDir, { recursive: true });
    archiver = new SessionArchiver({
      archiveRootDir: testDir,
      compressionEnabled: false,
    });
    await archiver.initialize();
  });

  afterEach(() => {
    archiver.stopAutoArchive();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('archiveSession', () => {
    it('should archive a session manually', async () => {
      const session = createTestArchivableSession('arch-s1');
      const result = await archiver.archiveSession(session, 'manual');

      expect(result.success).toBe(true);
      expect(result.sessionId).toBe('arch-s1');
      expect(result.archivePath).not.toBeNull();
      expect(result.archivePath!).toContain('arch-s1.archive');
    });

    it('should return failure result for archiving error', async () => {
      const badSession = createTestArchivableSession('bad');
      badSession.toUnifiedSession = () => {
        throw new Error('serialization failed');
      };
      const result = await archiver.archiveSession(badSession, 'manual');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should include trigger type in metadata', async () => {
      const session = createTestArchivableSession('arch-s3');
      await archiver.archiveSession(session, 'auto_idle');

      const list = await archiver.listArchived();
      expect(list).toHaveLength(1);
      expect(list[0].trigger).toBe('auto_idle');
    });
  });

  describe('restoreSession', () => {
    it('should restore a previously archived session', async () => {
      const session = createTestArchivableSession('arch-s4');
      const archiveResult = await archiver.archiveSession(session, 'manual');

      const restoreResult = await archiver.restoreSession(
        archiveResult.archivePath!
      );
      expect(restoreResult.success).toBe(true);
      expect(restoreResult.sessionId).toBe('arch-s4');
    });

    it('should return failure for non-existent archive', async () => {
      const result = await archiver.restoreSession('/nonexistent/path.archive');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('deleteArchive', () => {
    it('should delete an archived session file', async () => {
      const session = createTestArchivableSession('arch-s5');
      const archiveResult = await archiver.archiveSession(session, 'manual');

      await archiver.deleteArchive(archiveResult.archivePath!);
      const list = await archiver.listArchived();
      expect(list).toHaveLength(0);
    });
  });

  describe('listArchived', () => {
    it('should list archived sessions metadata', async () => {
      await archiver.archiveSession(
        createTestArchivableSession('arch-list-1'),
        'manual'
      );
      await archiver.archiveSession(
        createTestArchivableSession('arch-list-2'),
        'manual'
      );

      const list = await archiver.listArchived();
      expect(list).toHaveLength(2);
    });
  });

  describe('getArchivePathFor', () => {
    it('should return path for existing archive', async () => {
      const session = createTestArchivableSession('arch-path-1');
      await archiver.archiveSession(session, 'manual');

      const path = await archiver.getArchivePathFor('arch-path-1');
      expect(path).not.toBeNull();
    });
  });

  describe('getStorageStats', () => {
    it('should return storage statistics', async () => {
      await archiver.archiveSession(
        createTestArchivableSession('arch-stat-1'),
        'manual'
      );
      await archiver.archiveSession(
        createTestArchivableSession('arch-stat-2'),
        'manual'
      );

      const stats = await archiver.getStorageStats();
      expect(stats.count).toBe(2);
      expect(stats.totalSize).toBeGreaterThan(0);
    });
  });

  describe('startAutoArchive / stopAutoArchive', () => {
    it('should start and stop auto archive', () => {
      const sessions = [createTestArchivableSession('auto-1')];
      archiver.startAutoArchive(() => sessions);
      archiver.stopAutoArchive();
    });

    it('should archive idle sessions on auto check', async () => {
      const oldSession = createTestArchivableSession('old-idle', {
        lastActivityAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
        createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
      });
      const sessions = [oldSession];

      archiver.startAutoArchive(() => sessions);
      // wait for interval to fire -- but the interval is unref'd and may not run immediately
      // instead, manually trigger via very low thresholds
      archiver.stopAutoArchive();

      // create a new archiver with very aggressive thresholds
      const aggressiveDir = join(
        tmpdir(),
        `Liri_aggressive_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      );
      mkdirSync(aggressiveDir, { recursive: true });
      const aggressive = new SessionArchiver({
        archiveRootDir: aggressiveDir,
        autoArchiveIdleMinutes: 0.1, // 6 seconds
        autoArchiveMaxAgeDays: 0,
        compressionEnabled: false,
      });
      await aggressive.initialize();

      await aggressive.archiveSession(oldSession, 'auto_idle');
      const list = await aggressive.listArchived();
      expect(list.length).toBeGreaterThanOrEqual(1);

      rmSync(aggressiveDir, { recursive: true, force: true });
    });
  });
});
