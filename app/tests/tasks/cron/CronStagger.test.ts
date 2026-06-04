// MIT License
// Copyright (c) 2026 190615273@qq.com
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  isTopOfHourCronExpr,
  resolveStaggerOffsetMs,
  resolveCronStaggerMs,
  clearStaggerCacheForTest,
} from '../../../src/tasks/cron/CronStagger';

describe('CronStagger', () => {
  beforeEach(() => {
    clearStaggerCacheForTest();
  });

  describe('isTopOfHourCronExpr', () => {
    it('detects top-of-hour cron (hourly)', () => {
      expect(isTopOfHourCronExpr('0 * * * *')).toBe(true);
    });

    it('detects top-of-hour cron (daily 8am)', () => {
      // '0 8 * * *' hour field is '8', does not contain '*', so NOT top-of-hour
      // only '*', '*/N', or comma-separated patterns with '*' in hour qualify
      expect(isTopOfHourCronExpr('0 8 * * *')).toBe(false);
      // But '0 * * * *' (every hour) IS top-of-hour
      expect(isTopOfHourCronExpr('0 * * * *')).toBe(true);
    });

    it('rejects non-zero minute', () => {
      expect(isTopOfHourCronExpr('30 * * * *')).toBe(false);
    });

    it('detects step-based hourly', () => {
      // hour field contains '*'
      expect(isTopOfHourCronExpr('0 */2 * * *')).toBe(true);
    });

    it('rejects non-top-of-hour with minute range', () => {
      expect(isTopOfHourCronExpr('*/5 * * * *')).toBe(false);
    });

    it('handles 6-field cron', () => {
      expect(isTopOfHourCronExpr('0 0 * * * *')).toBe(true);
      expect(isTopOfHourCronExpr('0 30 * * * *')).toBe(false);
    });
  });

  describe('resolveStaggerOffsetMs', () => {
    it('returns 0 when staggerMs is 0', () => {
      expect(resolveStaggerOffsetMs('job-1', 0)).toBe(0);
    });

    it('returns 0 when staggerMs is 1', () => {
      expect(resolveStaggerOffsetMs('job-1', 1)).toBe(0);
    });

    it('returns deterministic value for same jobId', () => {
      const result1 = resolveStaggerOffsetMs('job-abc', 300_000);
      const result2 = resolveStaggerOffsetMs('job-abc', 300_000);
      expect(result1).toBe(result2);
    });

    it('returns value within stagger window', () => {
      const window = 300_000; // 5 minutes
      for (let i = 0; i < 100; i++) {
        const offset = resolveStaggerOffsetMs(`job-${i}`, window);
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThan(window);
      }
    });

    it('different jobIds produce different offsets (generally)', () => {
      const offset1 = resolveStaggerOffsetMs('job-aaa', 300_000);
      const offset2 = resolveStaggerOffsetMs('job-bbb', 300_000);
      // With high probability, these should differ
      // (collisions are mathematically possible but unlikely)
      const offset3 = resolveStaggerOffsetMs('job-ccc', 300_000);
      // At least 2 out of 3 should be unique
      const uniqueCount = new Set([offset1, offset2, offset3]).size;
      expect(uniqueCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('resolveCronStaggerMs', () => {
    it('returns explicit stagger when provided', () => {
      const result = resolveCronStaggerMs('0 * * * *', 'job-1', 10_000);
      expect(result).toBe(10_000);
    });

    it('returns 5min window for top-of-hour cron', () => {
      const result = resolveCronStaggerMs('0 * * * *', 'job-1');
      expect(result).toBe(5 * 60 * 1000);
    });

    it('returns 0 for non-top-of-hour cron', () => {
      const result = resolveCronStaggerMs('*/15 * * * *', 'job-1');
      expect(result).toBe(0);
    });
  });
});
