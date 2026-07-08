// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 文档分块器 (Chunker)
 *
 * 基于行窗口的文档分块，语言无关，每个分块携带精确的 startLine/endLine。
 *
 */

import * as fs from 'node:fs/promises';
import * as path from 'path';
import type { Dirent, Stats } from 'node:fs';

/** 代码分块 */
export interface CodeChunk {
  /** 相对于索引根目录的路径，正斜杠 */
  path: string;
  /** 1-based，包含 */
  startLine: number;
  /** 1-based，包含 */
  endLine: number;
  /** 分块文本内容 */
  text: string;
}

/** 跳过原因 */
export type SkipReason =
  | 'defaultDir'
  | 'defaultFile'
  | 'binaryExt'
  | 'binaryContent'
  | 'tooLarge'
  | 'gitignore'
  | 'pattern'
  | 'readError';

/** 分块选项 */
export interface ChunkOptions {
  /** 每窗口行数，默认 60 */
  windowLines?: number;
  /** 连续窗口重叠行数，默认 12 */
  overlap?: number;
  /** 每个分块最大字符数，默认 4000 */
  maxChunkChars?: number;
  /** 跳过的文件扩展名集合 */
  skipExtensions?: Set<string>;
  /** 最大文件大小（字节），默认 1MB */
  maxFileSize?: number;
  /** 跳过回调 */
  onSkip?: (relPath: string, reason: SkipReason) => void;
}

/** 默认最大分块字符数 */
export const DEFAULT_MAX_CHUNK_CHARS = 4000;

/** 默认忽略的目录 */
const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '__pycache__',
  '.venv',
  'venv',
  'dist',
  'build',
  '.next',
  '.cache',
  'target',
]);

/** 默认忽略的扩展名 */
const DEFAULT_IGNORE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.svg',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.mkv',
  '.webm',
  '.zip',
  '.tar',
  '.gz',
  '.rar',
  '.7z',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.o',
  '.obj',
  '.class',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.lock',
  '.min.js',
  '.min.css',
]);

/**
 * 对文本进行分块
 */
export function chunkText(
  text: string,
  filePath: string,
  windowLines: number,
  overlap: number,
  maxChunkChars: number = DEFAULT_MAX_CHUNK_CHARS
): CodeChunk[] {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) return [];
  const stride = Math.max(1, windowLines - overlap);
  const chunks: CodeChunk[] = [];
  for (let start = 0; start < lines.length; start += stride) {
    const end = Math.min(lines.length, start + windowLines);
    const slice = lines.slice(start, end).join('\n').trim();
    if (slice.length === 0) {
      if (end >= lines.length) break;
      continue;
    }
    const window: CodeChunk = {
      path: filePath,
      startLine: start + 1,
      endLine: end,
      text: slice,
    };
    for (const sub of safeSplit(window, maxChunkChars)) chunks.push(sub);
    if (end >= lines.length) break;
  }
  return chunks;
}

/**
 * 遍历目录并对所有符合条件的文件进行分块
 */
export async function chunkDirectory(
  rootDir: string,
  opts: ChunkOptions = {}
): Promise<CodeChunk[]> {
  const windowLines = opts.windowLines ?? 60;
  const overlap = opts.overlap ?? 12;
  const maxChunkChars = opts.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const skipExts = opts.skipExtensions ?? DEFAULT_IGNORE_EXTS;
  const maxFileSize = opts.maxFileSize ?? 1_000_000; // 1MB
  const onSkip = opts.onSkip;

  const chunks: CodeChunk[] = [];
  const normalizedRoot = path.resolve(rootDir);

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      if (onSkip) onSkip(path.relative(normalizedRoot, dir), 'readError');
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path
        .relative(normalizedRoot, fullPath)
        .replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (DEFAULT_IGNORE_DIRS.has(entry.name)) {
          onSkip?.(relPath, 'defaultDir');
          continue;
        }
        if (entry.name.startsWith('.')) {
          onSkip?.(relPath, 'defaultDir');
          continue;
        }
        await walk(fullPath);
        continue;
      }

      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (skipExts.has(ext)) {
          onSkip?.(relPath, 'binaryExt');
          continue;
        }

        let stat: Stats;
        try {
          stat = await fs.stat(fullPath);
        } catch {
          onSkip?.(relPath, 'readError');
          continue;
        }

        if (stat.size > maxFileSize) {
          onSkip?.(relPath, 'tooLarge');
          continue;
        }

        let content: string;
        try {
          content = await fs.readFile(fullPath, 'utf-8');
        } catch {
          onSkip?.(relPath, 'readError');
          continue;
        }

        // 检测二进制内容
        if (isBinaryContent(content)) {
          onSkip?.(relPath, 'binaryContent');
          continue;
        }

        const fileChunks = chunkText(
          content,
          relPath,
          windowLines,
          overlap,
          maxChunkChars
        );
        chunks.push(...fileChunks);
      }
    }
  }

  await walk(normalizedRoot);
  return chunks;
}

// ─── 内部工具 ────────────────────────────────────────────────────────────────

/** 安全拆分过大分块 */
function safeSplit(chunk: CodeChunk, maxChars: number): CodeChunk[] {
  if (chunk.text.length <= maxChars) return [chunk];
  const lines = chunk.text.split('\n');
  const out: CodeChunk[] = [];
  let bufLines: string[] = [];
  let bufStart = chunk.startLine;
  const flush = (untilLineNo: number): void => {
    if (bufLines.length === 0) return;
    out.push({
      path: chunk.path,
      startLine: bufStart,
      endLine: untilLineNo,
      text: bufLines.join('\n'),
    });
    bufLines = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.length > maxChars) {
      flush(chunk.startLine + i - 1);
      out.push({
        path: chunk.path,
        startLine: chunk.startLine + i,
        endLine: chunk.startLine + i + 1,
        text: line.slice(0, maxChars),
      });
      bufStart = chunk.startLine + i + 1;
      continue;
    }
    if (bufLines.join('\n').length + line.length + 1 > maxChars) {
      flush(chunk.startLine + i - 1);
      bufStart = chunk.startLine + i;
    }
    bufLines.push(line);
  }
  flush(chunk.startLine + lines.length - 1);
  return out;
}

/** 检测二进制内容 */
function isBinaryContent(content: string): boolean {
  const sample = content.slice(0, 8000);
  let nullCount = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample.charCodeAt(i) === 0) nullCount++;
  }
  return nullCount > 0;
}
