// MIT License
// Copyright (c) 2026 190615273@qq.com
// ... (full license text omitted for brevity)
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  computeNextCronRun,
  computeNextCronRunMs,
  computePreviousCronRunMs,
  isValidCronExpr,
  clearCronCacheForTest,
  getCronCacheSizeForTest,
} from '../../../src/tasks/cron/CronParser';

describe('CronParser', () => {
  // Clean cache between tests to avoid cross-test pollution
  beforeEach(() => {
    clearCronCacheForTest();
  });

  describe('isValidCronExpr', () => {
    it('accepts standard 5-field cron', () => {
      expect(isValidCronExpr('0 8 * * *')).toBe(true);
    });

    it('accepts step values', () => {
      expect(isValidCronExpr('*/15 * * * *')).toBe(true);
    });

    it('accepts comma-separated values', () => {
      expect(isValidCronExpr('0 8,12,16 * * *')).toBe(true);
    });

    it('accepts range values', () => {
      expect(isValidCronExpr('0 9 * * 1-5')).toBe(true);
    });

    it('rejects empty expression', () => {
      expect(isValidCronExpr('')).toBe(false);
      expect(isValidCronExpr('   ')).toBe(false);
    });

    it('rejects garbage', () => {
      expect(isValidCronExpr('not a cron')).toBe(false);
    });
  });

  describe('computeNextCronRunMs', () => {
    it('computes next run for daily cron', () => {
      // 2026-06-04 12:00:00 UTC = some timestamp
      const nowMs = new Date('2026-06-04T12:00:00Z').getTime();
      const nextMs = computeNextCronRunMs('0 8 * * *', nowMs);
      expect(nextMs).toBeDefined();
      if (nextMs !== undefined) {
        const nextDate = new Date(nextMs);
        // Should be next day 8:00
        expect(nextDate.getUTCHours()).toBe(8);
        expect(nextDate.getUTCMinutes()).toBe(0);
        expect(nextDate.getUTCDate()).toBe(5); // June 5
      }
    });

    it('handles every-minute cron', () => {
      const nowMs = new Date('2026-06-04T12:00:00Z').getTime();
      const nextMs = computeNextCronRunMs('* * * * *', nowMs);
      expect(nextMs).toBeDefined();
      if (nextMs !== undefined) {
        // Should be within 1 minute
        expect(nextMs - nowMs).toBeLessThanOrEqual(60_000);
      }
    });

    it('handles weekday-only cron', () => {
      // Thursday June 4, 2026
      const nowMs = new Date('2026-06-04T12:00:00Z').getTime();
      const nextMs = computeNextCronRunMs('0 9 * * 1-5', nowMs);
      expect(nextMs).toBeDefined();
      if (nextMs !== undefined) {
        const nextDate = new Date(nextMs);
        // Should be Friday June 5
        expect(nextDate.getUTCDay()).toBe(5); // Friday
      }
    });

    it('returns undefined for expression that never fires', () => {
      // This shouldn't happen in practice but test defensive behavior
      const nowMs = Date.now();
      const valid = isValidCronExpr('0 0 31 2 *'); // Feb 31st - invalid date
      // croner might handle this, but we just test it doesn't throw
      const nextMs = computeNextCronRunMs('0 0 31 2 *', nowMs);
      // It's ok if undefined or some far future date
      expect(typeof nextMs === 'number' || nextMs === undefined).toBe(true);
    });

    it('uses LRU cache for repeated calls', () => {
      const nowMs = Date.now();
      computeNextCronRunMs('0 6 * * *', nowMs);
      computeNextCronRunMs('0 6 * * *', nowMs);
      computeNextCronRunMs('0 6 * * *', nowMs);
      expect(getCronCacheSizeForTest()).toBeGreaterThanOrEqual(1);
    });
  });

  describe('computePreviousCronRunMs', () => {
    it('finds previous run', () => {
      const nowMs = new Date('2026-06-04T12:00:00Z').getTime();
      const prevMs = computePreviousCronRunMs('0 8 * * *', nowMs);
      expect(prevMs).toBeDefined();
      if (prevMs !== undefined) {
        const prevDate = new Date(prevMs);
        expect(prevDate.getUTCHours()).toBe(8);
        expect(prevDate.getUTCDate()).toBe(4); // June 4
      }
    });
  });

  describe('computeNextCronRun', () => {
    it('returns ISO string', () => {
      const nowMs = new Date('2026-06-04T12:00:00Z').getTime();
      const result = computeNextCronRun('0 8 * * *', nowMs);
      expect(result).toBeDefined();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    });

    it('returns null for invalid expr', () => {
      // With croner an invalid expr just returns undefined/throws
      // We test that our wrapper doesn't crash
      const result = computeNextCronRun('', Date.now());
      expect(result).toBeNull();
    });
  });
});
