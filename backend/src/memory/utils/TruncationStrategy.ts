/**
 * Memory截断策略
 * 参考CC_CODE MEMORY.md截断逻辑
 * 实现200行/25KB精确截断
 */

export const MEMORY_TRUNCATION_CONFIG = {
  ENTRYPOINT_NAME: 'MEMORY.md',
  MAX_ENTRYPOINT_LINES: 200,
  MAX_ENTRYPOINT_BYTES: 25_000,
};

export interface TruncationResult {
  content: string;
  lineCount: number;
  byteCount: number;
  wasLineTruncated: boolean;
  wasByteTruncated: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function truncateMemoryContent(raw: string): TruncationResult {
  const trimmed = raw.trim();
  const contentLines = trimmed.split('\n');
  const lineCount = contentLines.length;
  const byteCount = trimmed.length;

  const wasLineTruncated = lineCount > MEMORY_TRUNCATION_CONFIG.MAX_ENTRYPOINT_LINES;
  const wasByteTruncated = byteCount > MEMORY_TRUNCATION_CONFIG.MAX_ENTRYPOINT_BYTES;

  if (!wasLineTruncated && !wasByteTruncated) {
    return {
      content: trimmed,
      lineCount,
      byteCount,
      wasLineTruncated,
      wasByteTruncated,
    };
  }

  let truncated = wasLineTruncated
    ? contentLines.slice(0, MEMORY_TRUNCATION_CONFIG.MAX_ENTRYPOINT_LINES).join('\n')
    : trimmed;

  if (truncated.length > MEMORY_TRUNCATION_CONFIG.MAX_ENTRYPOINT_BYTES) {
    const cutAt = truncated.lastIndexOf('\n', MEMORY_TRUNCATION_CONFIG.MAX_ENTRYPOINT_BYTES);
    truncated = truncated.slice(0, cutAt > 0 ? cutAt : MEMORY_TRUNCATION_CONFIG.MAX_ENTRYPOINT_BYTES);
  }

  const reason =
    wasByteTruncated && !wasLineTruncated
      ? `${formatFileSize(byteCount)} (limit: ${formatFileSize(MEMORY_TRUNCATION_CONFIG.MAX_ENTRYPOINT_BYTES)}) — index entries are too long`
      : wasLineTruncated && !wasByteTruncated
        ? `${lineCount} lines (limit: ${MEMORY_TRUNCATION_CONFIG.MAX_ENTRYPOINT_LINES})`
        : `${lineCount} lines and ${formatFileSize(byteCount)}`;

  return {
    content:
      truncated +
      `\n\n> WARNING: ${MEMORY_TRUNCATION_CONFIG.ENTRYPOINT_NAME} is ${reason}. Only part of it was loaded. Keep index entries to one line under ~200 chars; move detail into topic files.`,
    lineCount,
    byteCount,
    wasLineTruncated,
    wasByteTruncated,
  };
}
