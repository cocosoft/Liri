/**
 * Cron expression parsing and scheduling module
 * Based on CC source: cc_code/backend/utils/cron.ts
 *
 * Supports three schedule input modes (aligned with OpenClaw):
 *   1. Standard 5-field cron: "0 8 * * *"
 *   2. Every-style: "every 30m" / "every 2 hours"
 *   3. At-style: "at 14:00" / "at 9:30"
 *   4. Macro aliases: @daily, @hourly, @weekly, @monthly, @yearly
 */

export type CronFields = {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
};

/** Normalized schedule kind, mirroring OpenClaw's CronSchedule union */
export type ScheduleKind = 'cron' | 'every' | 'at';

/** Parsed human-friendly schedule before normalization to 5-field cron */
export type ParsedSchedule =
  | { kind: 'cron'; expr: string }
  | { kind: 'every'; everyMs: number }
  | { kind: 'at'; at: string };

type FieldRange = { min: number; max: number };

// ─── Macro aliases ───
const MACRO_ALIASES: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

// ─── Every-style parsing ───
const EVERY_REGEX = /^every\s+(\d+)\s*(m(?:in(?:ute)?s?)?|hr?s?|h(?:our)?s?|d(?:ay)?s?)$/i;
const EVERY_MS_MAP: Record<string, number> = {
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
};

// ─── At-style parsing ───
const AT_REGEX = /^at\s+(\d{1,2}):(\d{2})$/i;

/**
 * Parse a human-friendly schedule expression into a ParsedSchedule.
 * Accepts:
 *   - Standard 5-field cron: "0 8 * * *"
 *   - Macro aliases: @daily, @hourly, etc.
 *   - Every-style: "every 30m", "every 2 hours"
 *   - At-style: "at 14:00"
 */
export function parseSchedule(expr: string): ParsedSchedule | null {
  const trimmed = expr.trim();
  if (!trimmed) return null;

  // Macro aliases
  const macro = MACRO_ALIASES[trimmed.toLowerCase()];
  if (macro) {
    return { kind: 'cron', expr: macro };
  }

  // Every-style
  const everyMatch = trimmed.match(EVERY_REGEX);
  if (everyMatch) {
    const value = parseInt(everyMatch[1]!, 10);
    const unit = everyMatch[2]!.toLowerCase();
    const msPerUnit = EVERY_MS_MAP[unit];
    if (msPerUnit && value > 0) {
      return { kind: 'every', everyMs: value * msPerUnit };
    }
  }

  // At-style
  const atMatch = trimmed.match(AT_REGEX);
  if (atMatch) {
    const hour = parseInt(atMatch[1]!, 10);
    const minute = parseInt(atMatch[2]!, 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { kind: 'at', at: trimmed };
    }
  }

  // Standard cron fallback
  if (trimmed.split(/\s+/).length === 5) {
    return { kind: 'cron', expr: trimmed };
  }

  return null;
}

/**
 * Convert a ParsedSchedule to a standard 5-field cron expression.
 */
export function scheduleToCron(schedule: ParsedSchedule): string {
  if (schedule.kind === 'cron') return schedule.expr;
  if (schedule.kind === 'at') {
    const m = schedule.at.match(AT_REGEX);
    if (m) return `${parseInt(m[2]!, 10)} ${parseInt(m[1]!, 10)} * * *`;
    return schedule.at;
  }
  // every
  const ms = schedule.everyMs;
  const minuteMs = 60_000;
  const hourMs = 3_600_000;
  const dayMs = 86_400_000;
  if (ms < minuteMs) return `*/${Math.round(ms / minuteMs)} * * * *`;
  if (ms < hourMs) return `*/${Math.round(ms / minuteMs)} * * * *`;
  if (ms < dayMs) return `0 */${Math.round(ms / hourMs)} * * *`;
  return `0 0 */${Math.round(ms / dayMs)} * *`;
}

/**
 * Normalize any schedule expression (cron/every/at/macro) to a 5-field cron string.
 * Returns null if the expression is invalid.
 */
export function normalizeSchedule(expr: string): string | null {
  const parsed = parseSchedule(expr);
  if (!parsed) return null;
  const cron = scheduleToCron(parsed);
  // Validate the resulting cron expression
  if (!parseCronExpression(cron)) return null;
  return cron;
}

const FIELD_RANGES: FieldRange[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 6 },
];

/**
 * Parse single cron field into array of matching values.
 * Supports: wildcard, N, step expressions, ranges, and lists.
 */
function expandField(field: string, range: FieldRange): number[] | null {
  const { min, max } = range;
  const out = new Set<number>();

  for (const part of field.split(',')) {
    const stepMatch = part.match(/^\*(?:\/(\d+))?$/);
    if (stepMatch) {
      const step = stepMatch[1] ? parseInt(stepMatch[1], 10) : 1;
      if (step < 1) return null;
      for (let i = min; i <= max; i += step) out.add(i);
      continue;
    }

    const rangeMatch = part.match(/^(\d+)-(\d+)(?:\/(\d+))?$/);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1]!, 10);
      const hi = parseInt(rangeMatch[2]!, 10);
      const step = rangeMatch[3] ? parseInt(rangeMatch[3], 10) : 1;
      const isDow = min === 0 && max === 6;
      const effMax = isDow ? 7 : max;
      if (lo > hi || step < 1 || lo < min || hi > effMax) return null;
      for (let i = lo; i <= hi; i += step) {
        out.add(isDow && i === 7 ? 0 : i);
      }
      continue;
    }

    const singleMatch = part.match(/^\d+$/);
    if (singleMatch) {
      let n = parseInt(part, 10);
      if (min === 0 && max === 6 && n === 7) n = 0;
      if (n < min || n > max) return null;
      out.add(n);
      continue;
    }

    return null;
  }

  if (out.size === 0) return null;
  return Array.from(out).sort((a, b) => a - b);
}

/**
 * Parse 5-field cron expression
 * @param expr cron expression string
 * @returns Parsed fields or null
 */
export function parseCronExpression(expr: string): CronFields | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const expanded: number[][] = [];
  for (let i = 0; i < 5; i++) {
    const result = expandField(parts[i]!, FIELD_RANGES[i]!);
    if (!result) return null;
    expanded.push(result);
  }

  return {
    minute: expanded[0]!,
    hour: expanded[1]!,
    dayOfMonth: expanded[2]!,
    month: expanded[3]!,
    dayOfWeek: expanded[4]!,
  };
}

/**
 * Compute next cron run time
 * @param fields Parsed cron fields
 * @param from Start time
 * @returns Next run time
 */
export function computeNextCronRun(
  fields: CronFields,
  from: Date
): Date | null {
  const minuteSet = new Set(fields.minute);
  const hourSet = new Set(fields.hour);
  const domSet = new Set(fields.dayOfMonth);
  const monthSet = new Set(fields.month);
  const dowSet = new Set(fields.dayOfWeek);

  const domWild = fields.dayOfMonth.length === 31;
  const dowWild = fields.dayOfWeek.length === 7;

  const t = new Date(from.getTime());
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);

  const maxIter = 366 * 24 * 60;
  for (let i = 0; i < maxIter; i++) {
    const month = t.getMonth() + 1;
    if (!monthSet.has(month)) {
      t.setMonth(t.getMonth() + 1, 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }

    const dom = t.getDate();
    const dow = t.getDay();
    const dayMatches =
      domWild && dowWild
        ? true
        : domWild
          ? dowSet.has(dow)
          : dowWild
            ? domSet.has(dom)
            : domSet.has(dom) || dowSet.has(dow);

    if (!dayMatches) {
      t.setDate(t.getDate() + 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }

    if (!hourSet.has(t.getHours())) {
      t.setHours(t.getHours() + 1, 0, 0, 0);
      continue;
    }

    if (!minuteSet.has(t.getMinutes())) {
      t.setMinutes(t.getMinutes() + 1);
      continue;
    }

    return t;
  }

  return null;
}

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function formatLocalTime(minute: number, hour: number): string {
  const d = new Date(2000, 0, 1, hour, minute);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * Convert cron expression to human-readable format
 * @param cron cron expression
 * @param utc use UTC timezone
 * @returns Human-readable time description
 */
export function cronToHuman(cron: string, utc: boolean = false): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];

  if (
    minute === '*' &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    return 'Every minute';
  }

  const everyMinMatch = minute.match(/^\*\/(\d+)$/);
  if (
    everyMinMatch &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const n = parseInt(everyMinMatch[1]!, 10);
    return `Every ${n} minutes`;
  }

  if (
    minute.match(/^\d+$/) &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const m = parseInt(minute, 10);
    if (m === 0) return 'Every hour';
    return `Every hour at :${m.toString().padStart(2, '0')}`;
  }

  const everyHourMatch = hour.match(/^\*\/(\d+)$/);
  if (
    minute.match(/^\d+$/) &&
    everyHourMatch &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const n = parseInt(everyHourMatch[1]!, 10);
    const m = parseInt(minute, 10);
    const suffix = m === 0 ? '' : ` at :${m.toString().padStart(2, '0')}`;
    return n === 1 ? `Every hour${suffix}` : `Every ${n} hours${suffix}`;
  }

  if (!minute.match(/^\d+$/) || !hour.match(/^\d+$/)) return cron;
  const m = parseInt(minute, 10);
  const h = parseInt(hour, 10);

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Every day at ${formatLocalTime(m, h)}`;
  }

  if (dayOfMonth === '*' && month === '*' && dayOfWeek.match(/^\d$/)) {
    const dayIndex = parseInt(dayOfWeek, 10) % 7;
    const dayName = DAY_NAMES[dayIndex];
    if (dayName) return `Every ${dayName} at ${formatLocalTime(m, h)}`;
  }

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '1-5') {
    return `Weekdays at ${formatLocalTime(m, h)}`;
  }

  return cron;
}

/**
 * Validate a schedule expression (supports cron, every, at, macro).
 * @param expr schedule expression string
 * @returns Whether valid
 */
export function isValidCronExpression(expr: string): boolean {
  const parsed = parseSchedule(expr);
  if (!parsed) return false;
  if (parsed.kind === 'every') return true;
  if (parsed.kind === 'at') return true;
  return parseCronExpression(parsed.expr) !== null;
}

/**
 * Get display text for a ParsedSchedule (human-friendly label).
 */
export function scheduleToDisplayText(
  expr: string,
  fallback: string = '—'
): string {
  const parsed = parseSchedule(expr);
  if (!parsed) return fallback;

  if (parsed.kind === 'every') {
    const ms = parsed.everyMs;
    if (ms >= 86_400_000) {
      const days = Math.round(ms / 86_400_000);
      return days === 1 ? 'Every day' : `Every ${days} days`;
    }
    if (ms >= 3_600_000) {
      const hours = Math.round(ms / 3_600_000);
      return hours === 1 ? 'Every hour' : `Every ${hours} hours`;
    }
    const minutes = Math.round(ms / 60_000);
    return minutes === 1 ? 'Every minute' : `Every ${minutes} minutes`;
  }

  if (parsed.kind === 'at') {
    const m = parsed.at.match(AT_REGEX);
    if (m) {
      const h = parseInt(m[1]!, 10);
      const min = parseInt(m[2]!, 10);
      return `At ${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')} daily`;
    }
    return parsed.at;
  }

  // cron - check for macro aliases
  const trimmed = expr.trim().toLowerCase();
  for (const [alias, expanded] of Object.entries(MACRO_ALIASES)) {
    if (trimmed === alias || expanded === parsed.expr) {
      const labels: Record<string, string> = {
        '@yearly': 'Yearly', '@annually': 'Yearly',
        '@monthly': 'Monthly', '@weekly': 'Weekly',
        '@daily': 'Daily', '@midnight': 'Daily',
        '@hourly': 'Hourly',
      };
      return labels[alias] || alias;
    }
  }

  return cronToHuman(parsed.expr);
}
