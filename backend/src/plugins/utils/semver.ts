/**
 * Semver版本比较工具
 * 参考CC源码 cc_code/backend/utils/semver.ts 实现
 * 支持版本比较和范围匹配
 */

/**
 * 版本比较结果
 */
export type SemverOrder = -1 | 0 | 1;

/**
 * 比较两个版本
 * @param a 版本A
 * @param b 版本B
 * @returns -1: a < b, 0: a == b, 1: a > b
 */
export function compare(a: string, b: string): SemverOrder {
  const aParts = parseVersion(a);
  const bParts = parseVersion(b);

  for (let i = 0; i < 3; i++) {
    const aNum = aParts[i] || 0;
    const bNum = bParts[i] || 0;
    if (aNum < bNum) return -1;
    if (aNum > bNum) return 1;
  }

  if (aParts[3] && bParts[3]) {
    const cmp = comparePrerelease(String(aParts[3]), String(bParts[3]));
    if (cmp !== 0) return cmp;
  } else if (aParts[3]) {
    return -1;
  } else if (bParts[3]) {
    return 1;
  }

  return 0;
}

/**
 * 解析版本字符串为主版本、次版本、补丁和预发布版本
 */
function parseVersion(version: string): (string | number)[] {
  const match = version.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-(.+))?$/);
  if (!match) return [0, 0, 0];
  return [
    parseInt(match[1], 10),
    parseInt(match[2] || '0', 10),
    parseInt(match[3] || '0', 10),
    match[4],
  ];
}

/**
 * 比较预发布版本
 */
function comparePrerelease(a: string, b: string): SemverOrder {
  const aParts = a.split('.');
  const bParts = b.split('.');

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aNum = parseInt(aParts[i] || '0', 10);
    const bNum = parseInt(bParts[i] || '0', 10);

    if (aNum < bNum) return -1;
    if (aNum > bNum) return 1;

    const aStr = aParts[i] || '';
    const bStr = bParts[i] || '';
    if (aStr < bStr) return -1;
    if (aStr > bStr) return 1;
  }

  return 0;
}

/**
 * 检查版本是否大于另一个版本
 */
export function gt(a: string, b: string): boolean {
  return compare(a, b) === 1;
}

/**
 * 检查版本是否大于或等于另一个版本
 */
export function gte(a: string, b: string): boolean {
  return compare(a, b) >= 0;
}

/**
 * 检查版本是否小于另一个版本
 */
export function lt(a: string, b: string): boolean {
  return compare(a, b) === -1;
}

/**
 * 检查版本是否小于或等于另一个版本
 */
export function lte(a: string, b: string): boolean {
  return compare(a, b) <= 0;
}

/**
 * 检查版本是否满足范围
 * 支持的格式：
 * - ^1.0.0: 主版本相同
 * - ~1.0.0: 主版本和次版本相同
 * - >=1.0.0: 大于等于
 * - 1.0.0 - 2.0.0: 范围
 * - ^1.0.0 || ^2.0.0: 或条件
 */
export function satisfies(version: string, range: string): boolean {
  const ranges = range.split('||').map((r) => r.trim());

  for (const r of ranges) {
    if (satisfiesSingle(version, r)) {
      return true;
    }
  }

  return false;
}

/**
 * 检查版本是否满足单个范围
 */
function satisfiesSingle(version: string, range: string): boolean {
  const trimmed = range.trim();

  if (trimmed.startsWith('^')) {
    return satisfiesCaret(version, trimmed.substring(1));
  }

  if (trimmed.startsWith('~')) {
    return satisfiesTilde(version, trimmed.substring(1));
  }

  if (trimmed.startsWith('>=')) {
    return gte(version, trimmed.substring(2));
  }

  if (trimmed.startsWith('>')) {
    if (trimmed.startsWith('>=')) {
      return gte(version, trimmed.substring(2));
    }
    return gt(version, trimmed.substring(1));
  }

  if (trimmed.startsWith('<=')) {
    return lte(version, trimmed.substring(2));
  }

  if (trimmed.startsWith('<')) {
    if (trimmed.startsWith('<=')) {
      return lte(version, trimmed.substring(2));
    }
    return lt(version, trimmed.substring(1));
  }

  if (trimmed.includes(' - ')) {
    const [start, end] = trimmed.split(' - ');
    return gte(version, start.trim()) && lte(version, end.trim());
  }

  return compare(version, trimmed) === 0;
}

/**
 * 检查是否满足caret范围 (^1.0.0 允许主版本不变)
 */
function satisfiesCaret(version: string, range: string): boolean {
  const rangeParts = parseVersion(range);
  const versionParts = parseVersion(version);

  if (versionParts[0] !== rangeParts[0]) {
    return false;
  }

  return gte(version, range);
}

/**
 * 检查是否满足tilde范围 (~1.0.0 允许主版本和次版本不变)
 */
function satisfiesTilde(version: string, range: string): boolean {
  const rangeParts = parseVersion(range);
  const versionParts = parseVersion(version);

  if (versionParts[0] !== rangeParts[0]) {
    return false;
  }

  if (versionParts[1] !== rangeParts[1]) {
    return false;
  }

  return gte(version, range);
}

/**
 * 对版本进行排序
 */
export function sort(versions: string[]): string[] {
  return [...versions].sort(compare);
}

/**
 * 获取版本范围字符串
 */
export function valid(range: string): string | null {
  if (satisfiesSingle('0.0.0', range)) {
    return range;
  }
  return null;
}
