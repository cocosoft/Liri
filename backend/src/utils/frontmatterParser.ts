/**
 * Frontmatter解析工具
 */

/**
 * 从frontmatter解析正整数
 */
export function parsePositiveIntFromFrontmatter(value: unknown): number | undefined {
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
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed) && Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}
