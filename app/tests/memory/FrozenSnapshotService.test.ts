// MIT License
// Copyright (c) 2026 190615273@qq.com

// P1-2: FrozenSnapshotService 单元测试
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  FrozenSnapshotService,
  resetFrozenSnapshotService,
  getFrozenSnapshotService,
} from '../../src/memory/FrozenSnapshotService';

describe('FrozenSnapshotService', () => {
  let service: FrozenSnapshotService;

  beforeEach(() => {
    resetFrozenSnapshotService();
    service = new FrozenSnapshotService();
  });

  describe('freeze / getFrozen', () => {
    it('returns null for unfrozen session', () => {
      expect(service.getFrozen('session-1')).toBeNull();
    });

    it('returns frozen content after freeze', () => {
      service.freeze('session-1', '<memory-context>test</memory-context>');
      expect(service.getFrozen('session-1')).toBe('<memory-context>test</memory-context>');
    });

    it('returns null for different session', () => {
      service.freeze('session-1', 'content-a');
      expect(service.getFrozen('session-2')).toBeNull();
    });

    it('overwrites on re-freeze', () => {
      service.freeze('session-1', 'old');
      service.freeze('session-1', 'new');
      expect(service.getFrozen('session-1')).toBe('new');
    });
  });

  describe('isFrozen', () => {
    it('returns false when no snapshot', () => {
      expect(service.isFrozen('session-1')).toBe(false);
    });

    it('returns true when frozen', () => {
      service.freeze('session-1', 'content');
      expect(service.isFrozen('session-1')).toBe(true);
    });
  });

  describe('unfreeze', () => {
    it('removes frozen snapshot for session', () => {
      service.freeze('session-1', 'content');
      service.unfreeze('session-1');
      expect(service.getFrozen('session-1')).toBeNull();
    });

    it('does not affect other sessions', () => {
      service.freeze('session-1', 'a');
      service.freeze('session-2', 'b');
      service.unfreeze('session-1');
      expect(service.getFrozen('session-2')).toBe('b');
    });

    it('is no-op for non-frozen session', () => {
      service.unfreeze('nonexistent');
      expect(service.frozenCount).toBe(0);
    });
  });

  describe('unfreezeAll', () => {
    it('clears all frozen snapshots', () => {
      service.freeze('s1', 'a');
      service.freeze('s2', 'b');
      service.freeze('s3', 'c');
      expect(service.frozenCount).toBe(3);
      service.unfreezeAll();
      expect(service.frozenCount).toBe(0);
    });
  });

  describe('frozenCount', () => {
    it('returns 0 initially', () => {
      expect(service.frozenCount).toBe(0);
    });

    it('increments with each freeze', () => {
      service.freeze('a', '1');
      service.freeze('b', '2');
      expect(service.frozenCount).toBe(2);
    });

    it('re-freezing same session does not increment', () => {
      service.freeze('a', '1');
      service.freeze('a', '2');
      expect(service.frozenCount).toBe(1);
    });
  });

  describe('singleton', () => {
    it('returns same instance', () => {
      resetFrozenSnapshotService();
      const a = getFrozenSnapshotService();
      const b = getFrozenSnapshotService();
      expect(a).toBe(b);
    });

    it('reset creates new instance', () => {
      const a = getFrozenSnapshotService();
      resetFrozenSnapshotService();
      const b = getFrozenSnapshotService();
      expect(a).not.toBe(b);
    });
  });

  describe('TTL expiry', () => {
    it('returns null when TTL expired (1ms TTL)', async () => {
      const ttlService = new FrozenSnapshotService(1); // 1ms TTL
      ttlService.freeze('session-1', 'content');
      await new Promise((r) => setTimeout(r, 5));
      expect(ttlService.getFrozen('session-1')).toBeNull();
    });

    it('returns content when not expired', () => {
      const ttlService = new FrozenSnapshotService(60000); // 60s TTL
      ttlService.freeze('session-1', 'content');
      expect(ttlService.getFrozen('session-1')).toBe('content');
    });
  });
});
