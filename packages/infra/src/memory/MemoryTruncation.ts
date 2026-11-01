/**
 * 双上限策略：MAX_LINES=200, MAX_BYTES=25000
 */

export const MAX_MEMORY_LINES = 200;
export const MAX_MEMORY_BYTES = 25_000;

export interface TruncationResult {
  content: string;
  lineCount: number;
  byteCount: number;
  wasLineTruncated: boolean;
  wasByteTruncated: boolean;
}

export function truncateMemoryContent(raw: string): TruncationResult {
  const trimmed = raw.trim();
  const contentLines = trimmed.split('\n');
  const lineCount = contentLines.length;
  const byteCount = Buffer.byteLength(trimmed, 'utf-8');

  const wasLineTruncated = lineCount > MAX_MEMORY_LINES;
  const wasByteTruncated = byteCount > MAX_MEMORY_BYTES;

  if (!wasLineTruncated && !wasByteTruncated) {
    return {
      content: trimmed,
      lineCount,
      byteCount,
      wasLineTruncated: false,
      wasByteTruncated: false,
    };
  }

  let truncated = wasLineTruncated
    ? contentLines.slice(0, MAX_MEMORY_LINES).join('\n')
    : trimmed;

  while (Buffer.byteLength(truncated, 'utf-8') > MAX_MEMORY_BYTES) {
    const lines = truncated.split('\n');
    lines.pop();
    truncated = lines.join('\n');
    if (lines.length === 0) break;
  }

  const warning = wasLineTruncated
    ? `\n[MEMORY.md truncated: exceeds ${MAX_MEMORY_LINES} lines]`
    : `\n[MEMORY.md truncated: exceeds ${MAX_MEMORY_BYTES} bytes]`;

  return {
    content: truncated + warning,
    lineCount: truncated.split('\n').length,
    byteCount: Buffer.byteLength(truncated, 'utf-8'),
    wasLineTruncated,
    wasByteTruncated,
  };
}
