/**
 * 记忆新鲜度机制（基于CC源码 memdir/memoryAge.ts）
 */

export interface MemoryFreshnessInfo {
  filePath: string;
  lastModified: number;
  ageMs: number;
  isFresh: boolean;
  freshnessNote: string;
}

const FRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24小时
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7天

export function getMemoryFreshness(
  filePath: string,
  lastModified: number
): MemoryFreshnessInfo {
  const ageMs = Date.now() - lastModified;
  const isFresh = ageMs < FRESH_THRESHOLD_MS;
  const isStale = ageMs > STALE_THRESHOLD_MS;

  let freshnessNote = '';
  if (isFresh) {
    freshnessNote = '(recently updated)';
  } else if (isStale) {
    const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    freshnessNote = `(last updated ${days} days ago — may be out of date)`;
  } else {
    const hours = Math.floor(ageMs / (60 * 60 * 1000));
    freshnessNote = `(updated ${hours} hours ago)`;
  }

  return { filePath, lastModified, ageMs, isFresh, freshnessNote };
}

export function memoryFreshnessNote(
  filePath: string,
  lastModified: number
): string {
  return getMemoryFreshness(filePath, lastModified).freshnessNote;
}
