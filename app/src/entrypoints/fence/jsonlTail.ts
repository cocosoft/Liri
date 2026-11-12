/**
 * JSONL 增读（围栏 M1）：按**字节偏移**增量读取 append-only 日志。
 *
 * 为什么自己实现而不用 `queryAuditLogs()`：后者每次整文件读（O(n) 轮询 ⇒ O(n²)），
 * 且属于被观察子系统的运行时代码。围栏只需要"从上次位置继续读"。
 *
 * 四条硬约束：
 * 1. **偏移是字节**（不是字符）：审计行含中文命令，按字符切会错位；
 * 2. **只消费完整行**：末尾半行留到下一轮（否则会把写到一半的 JSON 当坏行）；
 * 3. **文件变小 ⇒ 截断**：从 0 重读并告警（不静默丢事件）；
 * 4. **同长度替换也能识别**：轮转后新文件可能与旧文件等长 ⇒ 用"已消费前缀的摘要"
 *    再判一次（只比大小会漏，等于把新文件当成"没新增"）。
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** 一次增读的结果 */
export interface JsonlTailResult {
  exists: boolean;
  /** 完整行（已剔除空行；不做 JSON 解析） */
  lines: string[];
  /** 下一轮起点（字节） */
  nextOffset: number;
  /** 文件被截断/轮转（变小 **或** 已消费前缀摘要不匹配） */
  truncated: boolean;
  /** 已消费前缀的摘要，供下一轮识别"同长度替换" */
  consumedHash: string;
}

export interface JsonlTailDeps {
  /** 注入读取实现（单测可省去真实文件） */
  readFile?: (path: string) => Promise<Buffer>;
}

const NEWLINE = 0x0a;

/**
 * 从 `offset` 起读取新增的完整行。
 *
 * @param path 目标文件
 * @param offset 上次返回的 `nextOffset`（首次传 0）
 * @param deps 注入项
 * @param previousConsumedHash 上次返回的 `consumedHash`（用于识别同长度替换）
 */
export async function readAppendedJsonlLines(
  path: string,
  offset: number,
  deps: JsonlTailDeps = {},
  previousConsumedHash?: string
): Promise<JsonlTailResult> {
  const read = deps.readFile ?? ((p: string) => readFile(p));
  let buffer: Buffer;
  try {
    buffer = await read(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        exists: false,
        lines: [],
        nextOffset: 0,
        truncated: false,
        consumedHash: '',
      };
    }
    throw error;
  }

  const shrunk = buffer.length < offset;
  const replaced =
    !shrunk &&
    offset > 0 &&
    previousConsumedHash !== undefined &&
    consumedPrefixHash(buffer, offset) !== previousConsumedHash;
  const truncated = shrunk || replaced;
  const from = truncated ? 0 : offset;

  const slice = buffer.subarray(from);
  const lastNewline = slice.lastIndexOf(NEWLINE);
  if (lastNewline < 0) {
    // 只有半行（或空文件）：一行都不消费，偏移保持不变
    return {
      exists: true,
      lines: [],
      nextOffset: from,
      truncated,
      consumedHash: consumedPrefixHash(buffer, from),
    };
  }

  const complete = slice.subarray(0, lastNewline).toString('utf8');
  const nextOffset = from + lastNewline + 1;
  return {
    exists: true,
    lines: complete.split('\n').filter((line) => line.trim().length > 0),
    nextOffset,
    truncated,
    consumedHash: consumedPrefixHash(buffer, nextOffset),
  };
}

/**
 * 已消费前缀的短摘要。
 *
 * 续写时 `[0, end)` 不变 ⇒ 摘要不变；轮转/替换后几乎必然不同。
 * 用原生 sha1 而非纯 JS 循环：单次最多 10MB（审计日志轮转上限），
 * 10s 一次的采样下开销可忽略，且比逐字节更稳。
 */
function consumedPrefixHash(buffer: Buffer, end: number): string {
  return createHash('sha1')
    .update(buffer.subarray(0, end))
    .digest('hex')
    .slice(0, 16);
}
