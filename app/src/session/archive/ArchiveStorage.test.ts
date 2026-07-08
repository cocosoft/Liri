import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ArchiveStorage } from './ArchiveStorage';
import type { ArchiveConfig, ArchiveMetadata } from './ArchiveTypes';
import type { UnifiedSession } from '../types/Session';
import type { UnifiedMessage } from '../types/Message';

function createTestConfig(rootDir: string): ArchiveConfig {
  return {
    archiveRootDir: rootDir,
    autoArchiveIdleMinutes: 7 * 24 * 60,
    autoArchiveMaxAgeDays: 30,
    autoArchiveMaxSessions: 500,
    defaultTtlDays: 90,
    compressionEnabled: false,
  };
}

function createTestPayload(
  sessionId: string,
  overrides?: Partial<ArchiveMetadata>
): {
  session: UnifiedSession;
  messages: UnifiedMessage[];
  metadata: ArchiveMetadata;
} {
  return {
    session: {
      id: sessionId,
      type: 'local' as never,
      createdAt: Date.now() - 3600000,
      updatedAt: Date.now() - 600000,
      lastActivityAt: Date.now() - 600000,
      status: 'archived' as never,
      metadata: {},
    },
    messages: [
      {
        id: 'msg-1',
        sessionId,
        type: 'user' as never,
        role: 'user' as never,
        content: 'Hello',
        timestamp: Date.now() - 3600000,
      },
      {
        id: 'msg-2',
        sessionId,
        type: 'assistant' as never,
        role: 'assistant' as never,
        content: 'Hi there',
        timestamp: Date.now() - 1800000,
      },
    ],
    metadata: {
      sessionId,
      archivedAt: Date.now(),
      trigger: 'manual',
      originalSize: 500,
      compressedSize: 500,
      originalStatus: 'active',
      messageCount: 2,
      totalTokens: 150,
      ...overrides,
    },
  };
}

describe('ArchiveStorage', () => {
  let testDir: string;
  let storage: ArchiveStorage;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `Liri_archive_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    );
    mkdirSync(testDir, { recursive: true });
    storage = new ArchiveStorage(createTestConfig(testDir));
    await storage.initialize();
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('initialize', () => {
    it('should create archive directory on init', () => {
      expect(existsSync(testDir)).toBe(true);
    });
  });

  describe('archive / restore', () => {
    it('should archive a session and return the file path', async () => {
      const path = await storage.archive(createTestPayload('s1'));
      expect(path).toContain('s1.archive');
      expect(existsSync(path)).toBe(true);
    });

    it('should restore a previously archived session', async () => {
      const payload = createTestPayload('s2');
      const path = await storage.archive(payload);
      const restored = await storage.restore(path);
      expect(restored.metadata.sessionId).toBe('s2');
      expect(restored.session.id).toBe('s2');
      expect(restored.messages).toHaveLength(2);
    });
  });

  describe('delete', () => {
    it('should delete an archive file', async () => {
      const path = await storage.archive(createTestPayload('s3'));
      await storage.delete(path);
      expect(existsSync(path)).toBe(false);
    });
  });

  describe('listArchived', () => {
    it('should list all archived session metadata', async () => {
      await storage.archive(createTestPayload('s4', { sessionId: 's4' }));
      await storage.archive(createTestPayload('s5', { sessionId: 's5' }));

      const list = await storage.listArchived();
      expect(list).toHaveLength(2);
      const ids = list.map((m) => m.sessionId).sort();
      expect(ids).toEqual(['s4', 's5']);
    });

    it('should return empty list when no archives exist', async () => {
      const list = await storage.listArchived();
      expect(list).toEqual([]);
    });
  });

  describe('getArchivePathFor', () => {
    it('should return path for existing archive', async () => {
      await storage.archive(createTestPayload('s6'));
      const path = await storage.getArchivePathFor('s6');
      expect(path).not.toBeNull();
      expect(path!).toContain('s6.archive');
    });

    it('should return null for non-existent archive', async () => {
      const path = await storage.getArchivePathFor('nonexistent');
      expect(path).toBeNull();
    });
  });

  describe('getStorageStats', () => {
    it('should return stats for archived sessions', async () => {
      await storage.archive(createTestPayload('s7'));
      await storage.archive(createTestPayload('s8'));

      const stats = await storage.getStorageStats();
      expect(stats.count).toBe(2);
      expect(stats.totalSize).toBeGreaterThan(0);
      expect(stats.oldestArchive).toBeGreaterThan(0);
      expect(stats.newestArchive).toBeGreaterThan(0);
    });

    it('should return zeros when no archives exist', async () => {
      const stats = await storage.getStorageStats();
      expect(stats.count).toBe(0);
      expect(stats.totalSize).toBe(0);
      expect(stats.oldestArchive).toBe(0);
      expect(stats.newestArchive).toBe(0);
    });
  });
});
