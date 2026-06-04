// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import { describe, it, expect } from 'bun:test';
import {
  parseSchedule,
  scheduleToCron,
  normalizeSchedule,
  scheduleToDisplayText,
  parseCronExpression,
  computeNextCronRun,
  cronToHuman,
  isValidCronExpression,
} from '../../src/chronos/cron.js';

// ─── parseSchedule ──────────────────────────────────────────────

describe('parseSchedule', () => {

  // Macro aliases
  it('should parse @daily macro', () => {
    const result = parseSchedule('@daily');
    expect(result).toEqual({ kind: 'cron', expr: '0 0 * * *' });
  });

  it('should parse @hourly macro', () => {
    const result = parseSchedule('@hourly');
    expect(result).toEqual({ kind: 'cron', expr: '0 * * * *' });
  });

  it('should parse @weekly macro', () => {
    const result = parseSchedule('@weekly');
    expect(result).toEqual({ kind: 'cron', expr: '0 0 * * 0' });
  });

  it('should parse @monthly macro', () => {
    const result = parseSchedule('@monthly');
    expect(result).toEqual({ kind: 'cron', expr: '0 0 1 * *' });
  });

  it('should parse @yearly macro', () => {
    const result = parseSchedule('@yearly');
    expect(result).toEqual({ kind: 'cron', expr: '0 0 1 1 *' });
  });

  it('should parse @midnight as @daily', () => {
    const result = parseSchedule('@midnight');
    expect(result).toEqual({ kind: 'cron', expr: '0 0 * * *' });
  });

  // Every-style
  it('should parse "every 30m"', () => {
    const result = parseSchedule('every 30m');
    expect(result).toEqual({ kind: 'every', everyMs: 30 * 60_000 });
  });

  it('should parse "every 1 hour"', () => {
    const result = parseSchedule('every 1 hour');
    expect(result).toEqual({ kind: 'every', everyMs: 3_600_000 });
  });

  it('should parse "every 2 hours"', () => {
    const result = parseSchedule('every 2 hours');
    expect(result).toEqual({ kind: 'every', everyMs: 2 * 3_600_000 });
  });

  it('should parse "every 15 mins"', () => {
    const result = parseSchedule('every 15 mins');
    expect(result).toEqual({ kind: 'every', everyMs: 15 * 60_000 });
  });

  it('should parse "every 5 minutes"', () => {
    const result = parseSchedule('every 5 minutes');
    expect(result).toEqual({ kind: 'every', everyMs: 5 * 60_000 });
  });

  it('should parse "every 1d"', () => {
    const result = parseSchedule('every 1d');
    expect(result).toEqual({ kind: 'every', everyMs: 86_400_000 });
  });

  it('should parse "every 3 days"', () => {
    const result = parseSchedule('every 3 days');
    expect(result).toEqual({ kind: 'every', everyMs: 3 * 86_400_000 });
  });

  it('should parse every-style case-insensitively', () => {
    const result = parseSchedule('EVERY 10m');
    expect(result).toEqual({ kind: 'every', everyMs: 10 * 60_000 });
  });

  it('should parse "every 1 hr"', () => {
    const result = parseSchedule('every 1 hr');
    expect(result).toEqual({ kind: 'every', everyMs: 3_600_000 });
  });

  it('should return null for "every 0m"', () => {
    const result = parseSchedule('every 0m');
    expect(result).toBeNull();
  });

  // At-style
  it('should parse "at 14:00"', () => {
    const result = parseSchedule('at 14:00');
    expect(result).toEqual({ kind: 'at', at: 'at 14:00' });
  });

  it('should parse "at 9:30"', () => {
    const result = parseSchedule('at 9:30');
    expect(result).toEqual({ kind: 'at', at: 'at 9:30' });
  });

  it('should parse "at 0:05"', () => {
    const result = parseSchedule('at 0:05');
    expect(result).toEqual({ kind: 'at', at: 'at 0:05' });
  });

  it('should parse "at 23:59"', () => {
    const result = parseSchedule('at 23:59');
    expect(result).toEqual({ kind: 'at', at: 'at 23:59' });
  });

  it('should return null for "at 24:00" (invalid hour)', () => {
    const result = parseSchedule('at 24:00');
    expect(result).toBeNull();
  });

  it('should return null for "at 10:60" (invalid minute)', () => {
    const result = parseSchedule('at 10:60');
    expect(result).toBeNull();
  });

  it('should parse at-style case-insensitively', () => {
    const result = parseSchedule('AT 12:00');
    expect(result).toEqual({ kind: 'at', at: 'AT 12:00' });
  });

  // Standard cron
  it('should parse standard 5-field cron "0 8 * * *"', () => {
    const result = parseSchedule('0 8 * * *');
    expect(result).toEqual({ kind: 'cron', expr: '0 8 * * *' });
  });

  it('should parse "*/5 * * * *"', () => {
    const result = parseSchedule('*/5 * * * *');
    expect(result).toEqual({ kind: 'cron', expr: '*/5 * * * *' });
  });

  it('should parse "30 9 1-15 * *"', () => {
    const result = parseSchedule('30 9 1-15 * *');
    expect(result).toEqual({ kind: 'cron', expr: '30 9 1-15 * *' });
  });

  it('should return null for "0 8 *" (4 fields)', () => {
    const result = parseSchedule('0 8 *');
    expect(result).toBeNull();
  });

  it('should return null for empty string', () => {
    const result = parseSchedule('');
    expect(result).toBeNull();
  });

  it('should return null for whitespace-only', () => {
    const result = parseSchedule('   ');
    expect(result).toBeNull();
  });

  it('should return null for invalid expression "garbage text"', () => {
    const result = parseSchedule('garbage text');
    expect(result).toBeNull();
  });
});

// ─── scheduleToCron ─────────────────────────────────────────────

describe('scheduleToCron', () => {

  it('should return cron expr as-is for cron kind', () => {
    const result = scheduleToCron({ kind: 'cron', expr: '0 8 * * *' });
    expect(result).toBe('0 8 * * *');
  });

  it('should convert "at 14:30" to standard cron', () => {
    const result = scheduleToCron({ kind: 'at', at: 'at 14:30' });
    expect(result).toBe('30 14 * * *');
  });

  it('should convert "at 0:05" to standard cron', () => {
    const result = scheduleToCron({ kind: 'at', at: 'at 0:05' });
    expect(result).toBe('5 0 * * *');
  });

  it('should convert every 30m to step cron', () => {
    const result = scheduleToCron({ kind: 'every', everyMs: 30 * 60_000 });
    expect(result).toBe('*/30 * * * *');
  });

  it('should convert every 1m to step cron', () => {
    const result = scheduleToCron({ kind: 'every', everyMs: 60_000 });
    expect(result).toBe('*/1 * * * *');
  });

  it('should convert every 2 hours (>= 60min but < 24h)', () => {
    const result = scheduleToCron({ kind: 'every', everyMs: 2 * 3_600_000 });
    expect(result).toBe('0 */2 * * *');
  });

  it('should convert every 6 hours', () => {
    const result = scheduleToCron({ kind: 'every', everyMs: 6 * 3_600_000 });
    expect(result).toBe('0 */6 * * *');
  });
});

// ─── normalizeSchedule ──────────────────────────────────────────

describe('normalizeSchedule', () => {

  it('should normalize every-style to valid 5-field cron', () => {
    const result = normalizeSchedule('every 30m');
    expect(result).toBe('*/30 * * * *');
    // Verify it's valid
    const parsed = parseCronExpression(result!);
    expect(parsed).not.toBeNull();
  });

  it('should normalize at-style to valid 5-field cron', () => {
    const result = normalizeSchedule('at 14:00');
    expect(result).toBe('0 14 * * *');
  });

  it('should normalize @daily macro to valid 5-field cron', () => {
    const result = normalizeSchedule('@daily');
    expect(result).toBe('0 0 * * *');
  });

  it('should normalize standard cron as-is', () => {
    const result = normalizeSchedule('*/15 * * * *');
    expect(result).toBe('*/15 * * * *');
  });

  it('should return null for invalid input', () => {
    const result = normalizeSchedule('not a schedule');
    expect(result).toBeNull();
  });

  it('should return null for empty string', () => {
    const result = normalizeSchedule('');
    expect(result).toBeNull();
  });
});

// ─── parseCronExpression ────────────────────────────────────────

describe('parseCronExpression', () => {

  it('should parse wildcard cron', () => {
    const result = parseCronExpression('* * * * *');
    expect(result).not.toBeNull();
    expect(result!.minute.length).toBe(60);
    expect(result!.hour.length).toBe(24);
    expect(result!.dayOfMonth.length).toBe(31);
    expect(result!.month.length).toBe(12);
    expect(result!.dayOfWeek.length).toBe(7);
  });

  it('should parse specific minute/hours', () => {
    const result = parseCronExpression('30 9 * * *');
    expect(result).not.toBeNull();
    expect(result!.minute).toEqual([30]);
    expect(result!.hour).toEqual([9]);
  });

  it('should parse step expression */15', () => {
    const result = parseCronExpression('*/15 * * * *');
    expect(result).not.toBeNull();
    expect(result!.minute).toEqual([0, 15, 30, 45]);
  });

  it('should parse range expression', () => {
    const result = parseCronExpression('0 9-17 * * *');
    expect(result).not.toBeNull();
    expect(result!.hour).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it('should parse range with step', () => {
    const result = parseCronExpression('0 0-12/3 * * *');
    expect(result).not.toBeNull();
    expect(result!.hour).toEqual([0, 3, 6, 9, 12]);
  });

  it('should parse list expression', () => {
    const result = parseCronExpression('0 0,12 * * *');
    expect(result).not.toBeNull();
    expect(result!.hour).toEqual([0, 12]);
  });

  it('should return null for invalid field count', () => {
    const result = parseCronExpression('* * *');
    expect(result).toBeNull();
  });

  it('should return null for 6 fields', () => {
    const result = parseCronExpression('* * * * * *');
    expect(result).toBeNull();
  });

  it('should return null for out-of-range minute', () => {
    const result = parseCronExpression('60 * * * *');
    expect(result).toBeNull();
  });

  it('should return null for out-of-range hour', () => {
    const result = parseCronExpression('* 24 * * *');
    expect(result).toBeNull();
  });

  it('should return null for invalid pattern', () => {
    const result = parseCronExpression('abc * * * *');
    expect(result).toBeNull();
  });

  it('should parse complex cron "30 9 1-15 6 *"', () => {
    const result = parseCronExpression('30 9 1-15 6 *');
    expect(result).not.toBeNull();
    expect(result!.month).toEqual([6]);
    expect(result!.dayOfMonth!.length).toBe(15);
  });

  it('should convert Sunday=7 to 0', () => {
    const result = parseCronExpression('0 0 * * 7');
    expect(result).not.toBeNull();
    expect(result!.dayOfWeek).toContain(0);
  });

  it('should handle 7 in dayOfWeek range', () => {
    const result = parseCronExpression('0 0 * * 5-7');
    expect(result).not.toBeNull();
    expect(result!.dayOfWeek).toEqual([0, 5, 6]);
  });

  it('should return null for step 0', () => {
    const result = parseCronExpression('*/0 * * * *');
    expect(result).toBeNull();
  });

  it('should reject negative range', () => {
    const result = parseCronExpression('5-3 * * * *');
    expect(result).toBeNull();
  });
});

// ─── computeNextCronRun ─────────────────────────────────────────

describe('computeNextCronRun', () => {

  it('should compute next run for "0 8 * * *" (daily at 8:00)', () => {
    const fields = parseCronExpression('0 8 * * *')!;
    const from = new Date(2026, 5, 4, 6, 0, 0); // June 4, 2026 6:00 AM
    const next = computeNextCronRun(fields, from);
    expect(next).not.toBeNull();
    expect(next!.getHours()).toBe(8);
    expect(next!.getMinutes()).toBe(0);
  });

  it('should roll to next day if already past the time', () => {
    const fields = parseCronExpression('0 8 * * *')!;
    const from = new Date(2026, 5, 4, 10, 0, 0); // 10:00 AM
    const next = computeNextCronRun(fields, from);
    expect(next).not.toBeNull();
    expect(next!.getHours()).toBe(8);
    expect(next!.getMinutes()).toBe(0);
    expect(next!.getDate()).toBe(5); // next day
  });

  it('should compute next for "*/15 * * * *"', () => {
    const fields = parseCronExpression('*/15 * * * *')!;
    const from = new Date(2026, 5, 4, 6, 7, 0); // 6:07
    const next = computeNextCronRun(fields, from);
    expect(next).not.toBeNull();
    expect(next!.getMinutes()).toBe(15);
    expect(next!.getHours()).toBe(6);
  });

  it('should compute next for "0 0 * * 1" (every Monday)', () => {
    const fields = parseCronExpression('0 0 * * 1')!;
    // June 4, 2026 is Thursday (dow=4). Next Monday = June 8.
    const from = new Date(2026, 5, 4, 6, 0, 0);
    const next = computeNextCronRun(fields, from);
    expect(next).not.toBeNull();
    expect(next!.getDay()).toBe(1); // Monday
    expect(next!.getDate()).toBe(8);
  });

  it('should return null for an impossible schedule (edge case limit)', () => {
    // Use a schedule with only Feb 31 which is impossible
    const fields = parseCronExpression('0 0 31 2 *')!;
    const from = new Date(2026, 5, 4, 6, 0, 0);
    const next = computeNextCronRun(fields, from);
    // This may return null after exhausting iterations
    expect(next).toBeNull();
  });
});

// ─── cronToHuman ────────────────────────────────────────────────

describe('cronToHuman', () => {

  it('should describe every-minute cron', () => {
    expect(cronToHuman('* * * * *')).toBe('Every minute');
  });

  it('should describe every N minutes', () => {
    expect(cronToHuman('*/5 * * * *')).toBe('Every 5 minutes');
    expect(cronToHuman('*/15 * * * *')).toBe('Every 15 minutes');
  });

  it('should describe hourly', () => {
    expect(cronToHuman('0 * * * *')).toBe('Every hour');
  });

  it('should describe hourly with minutes', () => {
    expect(cronToHuman('30 * * * *')).toBe('Every hour at :30');
  });

  it('should describe daily at specific time', () => {
    const result = cronToHuman('0 8 * * *');
    expect(result).toContain('Every day');
    expect(result).toContain('8:00');
  });

  it('should describe weekly', () => {
    const result = cronToHuman('0 9 * * 0');
    expect(result).toContain('Sunday');
    expect(result).toContain('9:00');
  });

  it('should describe weekdays', () => {
    const result = cronToHuman('0 9 * * 1-5');
    expect(result).toContain('Weekdays');
    expect(result).toContain('9:00');
  });

  it('should return raw cron for unsupported patterns', () => {
    expect(cronToHuman('1,5,10 * * * *')).toBe('1,5,10 * * * *');
  });
});

// ─── isValidCronExpression ──────────────────────────────────────

describe('isValidCronExpression', () => {

  it('should validate standard cron', () => {
    expect(isValidCronExpression('*/15 * * * *')).toBe(true);
  });

  it('should validate every-style', () => {
    expect(isValidCronExpression('every 30m')).toBe(true);
  });

  it('should validate at-style', () => {
    expect(isValidCronExpression('at 14:00')).toBe(true);
  });

  it('should validate macro alias', () => {
    expect(isValidCronExpression('@daily')).toBe(true);
  });

  it('should reject invalid cron', () => {
    expect(isValidCronExpression('60 * * * *')).toBe(false);
  });

  it('should reject garbage', () => {
    expect(isValidCronExpression('not a schedule')).toBe(false);
  });
});

// ─── scheduleToDisplayText ──────────────────────────────────────

describe('scheduleToDisplayText', () => {

  it('should display macro alias as label', () => {
    expect(scheduleToDisplayText('@daily')).toBe('Daily');
    expect(scheduleToDisplayText('@hourly')).toBe('Hourly');
    expect(scheduleToDisplayText('@weekly')).toBe('Weekly');
    expect(scheduleToDisplayText('@monthly')).toBe('Monthly');
    expect(scheduleToDisplayText('@yearly')).toBe('Yearly');
  });

  it('should display every-style with minute precision', () => {
    expect(scheduleToDisplayText('every 30m')).toBe('Every 30 minutes');
    expect(scheduleToDisplayText('every 5 mins')).toBe('Every 5 minutes');
    expect(scheduleToDisplayText('every 1 minute')).toBe('Every minute');
  });

  it('should display every-style with hour precision', () => {
    expect(scheduleToDisplayText('every 2 hours')).toBe('Every 2 hours');
    expect(scheduleToDisplayText('every 1 hour')).toBe('Every hour');
  });

  it('should display every-style with day precision', () => {
    expect(scheduleToDisplayText('every 1d')).toBe('Every day');
    expect(scheduleToDisplayText('every 3 days')).toBe('Every 3 days');
  });

  it('should display at-style', () => {
    expect(scheduleToDisplayText('at 14:00')).toBe('At 14:00 daily');
    expect(scheduleToDisplayText('at 9:30')).toBe('At 09:30 daily');
  });

  it('should display standard cron as human text', () => {
    expect(scheduleToDisplayText('0 8 * * *')).toContain('Every day');
  });

  it('should return fallback for invalid expression', () => {
    expect(scheduleToDisplayText('invalid', '—')).toBe('—');
  });

  it('should return default fallback for invalid expression', () => {
    expect(scheduleToDisplayText('invalid')).toBe('—');
  });
});
