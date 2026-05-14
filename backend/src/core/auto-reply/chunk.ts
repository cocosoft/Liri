import type { ChunkMode, ChunkResult } from './types.js';

const DEFAULT_CHUNK_LIMIT = 4000;

/**
 * 将文本分割为平台适配的块。
 * length 模式：仅在超出限制时分割，优先在段落边界断开。
 * newline 模式：优先在段落边界（空行）分割，超限时强制按长度分割。
 */
export function chunkText(
  text: string,
  limit: number = DEFAULT_CHUNK_LIMIT,
  mode: ChunkMode = 'length',
): ChunkResult {
  if (!text) {
    return { chunks: [], mode, originalLength: 0, chunkCount: 0 };
  }

  if (text.length <= limit) {
    return { chunks: [text], mode, originalLength: text.length, chunkCount: 1 };
  }

  const chunks: string[] = [];

  if (mode === 'newline') {
    const paragraphs = text.split(/\n\s*\n/);
    let current = '';

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;

      const candidate = current ? `${current}\n\n${trimmed}` : trimmed;

      if (candidate.length <= limit) {
        current = candidate;
      } else {
        if (current) {
          chunks.push(current);
          current = '';
        }
        if (trimmed.length <= limit) {
          current = trimmed;
        } else {
          const subChunks = splitByLength(trimmed, limit);
          chunks.push(...subChunks.slice(0, -1));
          current = subChunks[subChunks.length - 1];
        }
      }
    }

    if (current) {
      chunks.push(current);
    }
  } else {
    const paragraphs = text.split(/\n\s*\n/);
    let current = '';

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;

      const candidate = current ? `${current}\n\n${trimmed}` : trimmed;

      if (candidate.length <= limit) {
        current = candidate;
      } else {
        if (current) {
          chunks.push(current);
          current = '';
        }

        if (trimmed.length <= limit) {
          current = trimmed;
        } else {
          const subChunks = splitByLength(trimmed, limit);
          chunks.push(...subChunks.slice(0, -1));
          current = subChunks[subChunks.length - 1];
        }
      }
    }

    if (current) {
      chunks.push(current);
    }
  }

  if (chunks.length === 0) {
    chunks.push(text);
  }

  return { chunks, mode, originalLength: text.length, chunkCount: chunks.length };
}

/**
 * 按长度将文本硬分割为块。
 */
function splitByLength(text: string, limit: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    chunks.push(text.slice(start, start + limit));
    start += limit;
  }

  return chunks;
}

/**
 * 为指定渠道解析分块限制。
 */
export function resolveChunkLimit(
  channelId?: string,
  accountId?: string,
  options?: { fallbackLimit?: number },
): number {
  const fallback = options?.fallbackLimit ?? DEFAULT_CHUNK_LIMIT;

  if (!channelId) {
    return fallback;
  }

  const channelLimits: Record<string, Record<string, number>> = {
    irc: { '*': 400 },
    slack: { '*': 4000 },
    line: { '*': 5000 },
    discord: { '*': 2000 },
    telegram: { '*': 4096 },
  };

  const channelLimitMap = channelLimits[channelId];
  if (!channelLimitMap) {
    return fallback;
  }

  if (accountId && channelLimitMap[accountId]) {
    return channelLimitMap[accountId];
  }

  return channelLimitMap['*'] ?? fallback;
}
