/**
 * Effort工具
 */

/**
 * Effort级别
 */
export const EFFORT_LEVELS = ['low', 'medium', 'high'] as const;

/**
 * Effort值类型
 */
export type EffortValue = (typeof EFFORT_LEVELS)[number] | number;

/**
 * 解析effort值
 */
export function parseEffortValue(value: unknown): EffortValue | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value) && value > 0) {
      return value;
    }
    return undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (EFFORT_LEVELS.includes(trimmed as (typeof EFFORT_LEVELS)[number])) {
      return trimmed as (typeof EFFORT_LEVELS)[number];
    }

    const parsed = parseInt(trimmed, 10);
    if (!isNaN(parsed) && Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}
