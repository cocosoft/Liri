// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * bashOutputTruncate — Bash 大输出**源头软截断**（G18，2026-10-11）
 *
 * 自 `BashTool.ts` **纯搬迁**（只搬不改）抽出的内聚单元：K-5 P1 内存治理的阈值常量 + 截断函数。
 * 抽出目的：缩小 `BashTool.ts` 的"上帝对象"体量；语义与实现**逐字保持**（含日志文案与阈值）。
 */

import { getLogger } from '@modules/monitoring';

const logger = getLogger('tools\bash\bashOutputTruncate');

/**
 * K-5 P1 软截断阈值（默认 2MB）。超过此阈值后返回前缀 + 标注，避免超大输出打爆上下文/内存。
 * 注意：这是工具层的"用户可见返回"截断，不等于 exec 内部的 maxBuffer；
 *       两者同时生效，双层防护（硬防线 16MB > 软截断 2MB）。
 */
export const BASH_OUTPUT_SOFT_LIMIT_BYTES = 2 * 1024 * 1024; // 2 MB
/**
 * K-5 P1 硬截断阈值（默认 16MB）。传给 child_process.exec 的 maxBuffer。
 * 超过此阈值底层 execAsync 会直接抛错（ERR_CHILD_PROCESS_STDIO_MAXBUFFER），
 * 因此软截断（2MB）应始终小于此值，避免"还没到软截断就先被底层打挂"。
 */
export const BASH_EXEC_MAX_BUFFER_BYTES = 16 * 1024 * 1024; // 16 MB
/** 截断时保留的尾部字节数（默认 20KB） */
export const BASH_TRUNCATED_TAIL_BYTES = 20 * 1024; // 20 KB 尾部，便于定位最后报错

/**
 * K-5 P1 内存治理：Bash stdout/stderr 源头软截断（2MB 前缀 + 20KB 尾部 + 标注）。
 * 避免 cat 10GB 日志 → 10GB 字符串 → 内存爆 + 上下文爆。
 *
 * 算法（避免 Buffer.byteLength 对超大字符串二次复制的负担）：
 *   当 s.length*3 < 软阈值 → 快速路径（ASCII 常见）直接返回，不 new Buffer
 *   否则 → Buffer.byteLength + Buffer.slice（UTF-8 安全切分，不会把一个多字节字符切两半）
 */
export function applyBashOutputSoftTruncate(
  s: string | undefined | null,
  streamName: 'stdout' | 'stderr'
): string {
  if (s == null) return '';
  // 快速路径：ASCII 估算不足阈值直接返回（多数命令输出短）
  if (s.length * 3 < BASH_OUTPUT_SOFT_LIMIT_BYTES) return s;

  let byteLen: number;
  try {
    byteLen = Buffer.byteLength(s, 'utf-8');
  } catch {
    // byteLength 理论上永不对字符串抛错（极端超大字符串 V8 OOM 另论），保守兜底 slice 按字符
    logger.warn(
      'applyBashOutputSoftTruncate: Buffer.byteLength 失败，回退字符截断',
      {
        stream: streamName,
        len: s.length,
      }
    );
    const safeChars = Math.floor(BASH_OUTPUT_SOFT_LIMIT_BYTES / 3);
    if (s.length <= safeChars) return s;
    return (
      s.slice(0, safeChars) +
      `\n\n[K-5 truncated ${streamName}: ${s.length} chars > limit, kept ~${safeChars}]`
    );
  }

  if (byteLen <= BASH_OUTPUT_SOFT_LIMIT_BYTES) return s;

  // 超限：head（软阈值 - 尾部余量）+ 尾部保留 + 标注
  const headReserveBytes = Math.max(
    0,
    BASH_OUTPUT_SOFT_LIMIT_BYTES - BASH_TRUNCATED_TAIL_BYTES
  );
  const buf = Buffer.from(s, 'utf-8');
  const head = buf.slice(0, headReserveBytes).toString('utf-8');
  const tail =
    BASH_TRUNCATED_TAIL_BYTES > 0
      ? buf
          .slice(Math.max(0, buf.length - BASH_TRUNCATED_TAIL_BYTES))
          .toString('utf-8')
      : '';

  logger.warn('K-5 BashTool 大输出源头截断', {
    stream: streamName,
    originalBytes: byteLen,
    keptBytes: BASH_OUTPUT_SOFT_LIMIT_BYTES,
    limitBytes: BASH_OUTPUT_SOFT_LIMIT_BYTES,
  });

  const notice =
    `\n\n[K-5 output truncated on ${streamName}]\n` +
    `original=${formatBytes(byteLen)}  kept_head=${formatBytes(headReserveBytes)}  tail=${formatBytes(BASH_TRUNCATED_TAIL_BYTES)}  soft_limit=${formatBytes(BASH_OUTPUT_SOFT_LIMIT_BYTES)}\n` +
    `[Tip: rerun with filters (grep/findstr/Select-String) or pipe to a file, then read the file.]\n\n--- tail ---\n`;
  return head + notice + tail;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}
