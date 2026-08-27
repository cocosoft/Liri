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

import * as fs from 'fs/promises';
import * as path from 'path';
import type { Dirent, Stats } from 'fs';

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
  /** 前一个块的 ID（用于上下文富化） */
  preChunkId?: string;
  /** 后一个块的 ID（用于上下文富化） */
  nextChunkId?: string;
  /** 父块 ID（父子分块时，子块指向父块） */
  parentChunkId?: string;
  /** 标题上下文，如 "## 安装指南 > ### Docker 部署" */
  contextHeader?: string;
  /** KB-SEM（2026-08-27）：源文件修改时间（ms），用于增量构建判断文件是否变化 */
  mtimeMs?: number;
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
  /** 是否使用自适应分块策略（标题感知），默认 true */
  useAutoChunk?: boolean;
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
  const useAutoChunk = opts.useAutoChunk ?? true; // 默认启用自适应分块

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
        // KB-SEM（2026-08-27）：知识库内部 raw/ 源目录不索引（上传二进制伴侣 md），
        // 与 FileDocsProvider 扫描一致；.knowledge-trash 已由 . 前缀过滤覆盖
        if (entry.name === 'raw') {
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

        const fileChunks = useAutoChunk
          ? autoChunk(content, relPath, opts)
          : chunkText(content, relPath, windowLines, overlap, maxChunkChars);
        // KB-SEM（2026-08-27）：携带真实文件 mtime，供增量构建比较文件是否修改
        for (const c of fileChunks) c.mtimeMs = stat.mtimeMs;
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

// ---- 智能分块（O4+O6） ----

/**
 * 标题感知分块
 *
 * 按 Markdown 标题（# ~ ######）分节，每节作为一个候选块。
 * 若节超过 maxChunkChars，递归拆分。每个块携带标题上下文。
 */
export function headingAwareChunk(
  text: string,
  filePath: string,
  windowLines: number = 60,
  maxChunkChars: number = 4000
): CodeChunk[] {
  const lines = text.split('\n');
  const sections: Array<{
    heading: string;
    startLine: number;
    endLine: number;
    sectionLines: string[];
  }> = [];
  let currentHeading = '';
  let sectionStart = 1;
  const sectionLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i]?.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch && sectionLines.length > 0) {
      // 遇到新标题，保存当前节
      sections.push({
        heading: currentHeading || headingMatch[2],
        startLine: sectionStart,
        endLine: i,
        sectionLines: [...sectionLines],
      });
      sectionLines.length = 0;
      sectionStart = i + 1;
    }
    if (headingMatch) {
      currentHeading = headingMatch[2];
    }
    sectionLines.push(lines[i] ?? '');
  }

  // 保存最后一节
  if (sectionLines.length > 0) {
    sections.push({
      heading: currentHeading,
      startLine: sectionStart,
      endLine: lines.length,
      sectionLines: [...sectionLines],
    });
  }

  // 若无标题，回退到行窗口
  if (sections.length <= 1 && !sections[0]?.heading) {
    return chunkText(text, filePath, windowLines, 0, maxChunkChars);
  }

  const chunks: CodeChunk[] = [];
  for (const sec of sections) {
    const secText = sec.sectionLines.join('\n');
    if (secText.length <= maxChunkChars) {
      chunks.push({
        path: filePath,
        startLine: sec.startLine,
        endLine: sec.endLine,
        text: secText,
        contextHeader: sec.heading || undefined,
      });
    } else {
      // 节过大，递归行窗口分块
      const subChunks = chunkText(
        secText,
        filePath,
        windowLines,
        0,
        maxChunkChars
      ).map((c) => ({
        ...c,
        startLine: c.startLine + sec.startLine - 1,
        endLine: c.endLine + sec.startLine - 1,
        contextHeader: sec.heading || undefined,
      }));
      chunks.push(...subChunks);
    }
  }

  // 设置 preChunkId/nextChunkId 链
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) {
      chunks[i]!.preChunkId =
        `${filePath}#L${chunks[i - 1]!.startLine}-L${chunks[i - 1]!.endLine}`;
    }
    if (i < chunks.length - 1) {
      chunks[i]!.nextChunkId =
        `${filePath}#L${chunks[i + 1]!.startLine}-L${chunks[i + 1]!.endLine}`;
    }
  }

  return chunks;
}

/**
 * 自适应分块策略
 *
 * 根据文档特征自动选择最优分块方式：
 *   - 有 Markdown 标题 → 标题感知分块
 *   - 短文档（< 10000 字符）→ 行窗口分块
 *   - 长文档 → 行窗口分块（fallback）
 */
export function autoChunk(
  text: string,
  filePath: string,
  options?: ChunkOptions
): CodeChunk[] {
  const windowLines = options?.windowLines ?? 60;
  const overlap = options?.overlap ?? 12;
  const maxChunkChars = options?.maxChunkChars ?? 4000;
  const hasHeadings = /^#{1,6}\s/m.test(text);

  if (hasHeadings) {
    return parentChildChunk(text, filePath, windowLines, maxChunkChars);
  }
  return chunkText(text, filePath, windowLines, overlap, maxChunkChars);
}

/**
 * 父子分块
 *
 * 先做标题感知分块得子块，再按标题层级合并生成父块（摘要块）。
 * 子块通过 parentChunkId 指向父块，实现分层检索。
 */
export function parentChildChunk(
  text: string,
  filePath: string,
  windowLines: number = 60,
  maxChunkChars: number = 4000
): CodeChunk[] {
  const childChunks = headingAwareChunk(
    text,
    filePath,
    windowLines,
    maxChunkChars
  );
  const parentChunks: CodeChunk[] = [];

  // 按标题层级分组：连续同层级（或更深）的块共享同一父块
  let currentParent: CodeChunk | null = null;

  for (let i = 0; i < childChunks.length; i++) {
    const child = childChunks[i]!;
    const header = child.contextHeader?.split(' > ').pop() ?? '';
    const isH2 = child.contextHeader?.startsWith('# ') ?? false;

    // 遇到 H1/H2 标题，开新父块
    if (isH2 || !currentParent) {
      if (currentParent && currentParent.text.length > 0) {
        parentChunks.push(currentParent);
      }

      const parentId = `${filePath}#parent-L${child.startLine}`;
      currentParent = {
        path: filePath,
        startLine: child.startLine,
        endLine: child.endLine,
        text: `[摘要] ${header}: ${child.text.slice(0, 800)}`,
        contextHeader: child.contextHeader,
      };

      // 为所有子块分配相同 parentId（稍后补）
      currentParent.preChunkId = parentId;
    }

    // 子块指向父块
    child.parentChunkId = currentParent?.preChunkId;
    if (currentParent) {
      currentParent.endLine = Math.max(currentParent.endLine, child.endLine);
    }
  }

  if (currentParent && currentParent.text.length > 0) {
    parentChunks.push(currentParent);
  }

  return [...childChunks, ...parentChunks];
}
