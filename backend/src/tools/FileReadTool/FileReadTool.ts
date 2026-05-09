/**
 * FileReadTool - 文件读取工具
 * 基于CC源码 FileReadTool 模式
 */
import * as fs from 'fs';
import * as path from 'path';

export interface FileReadInput {
  filePath: string;
  offset?: number;
  limit?: number;
}

export interface FileReadResult {
  content: string;
  filePath: string;
  totalLines: number;
  lineCount: number;
  offset: number;
  sizeBytes: number;
  truncated: boolean;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB
const BLOCKED_PATHS = new Set(['/dev/zero', '/dev/random', '/dev/urandom']);

export function readFile(input: FileReadInput): FileReadResult {
  const resolved = path.resolve(input.filePath);

  if (BLOCKED_PATHS.has(resolved)) {
    throw new Error(`Blocked device path: ${resolved}`);
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    throw new Error(`Path is a directory: ${resolved}`);
  }

  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(
      `File too large: ${(stat.size / 1024 / 1024).toFixed(1)} MiB (max 10 MiB)`
    );
  }

  const content = fs.readFileSync(resolved, 'utf-8');
  const allLines = content.split('\n');
  const totalLines = allLines.length;
  const offset = input.offset ?? 1;
  const limit = input.limit ?? Math.min(totalLines, 2000);

  const startLine = Math.max(0, offset - 1);
  const endLine = Math.min(totalLines, startLine + limit);
  const selectedLines = allLines.slice(startLine, endLine);

  let result = selectedLines.join('\n');
  if (offset > 1 || limit < totalLines) {
    result = addLineNumbers(result, startLine + 1);
  }

  return {
    content: result,
    filePath: resolved,
    totalLines,
    lineCount: selectedLines.length,
    offset,
    sizeBytes: stat.size,
    truncated: endLine < totalLines,
  };
}

export function addLineNumbers(content: string, startLine: number = 1): string {
  return content
    .split('\n')
    .map((line, i) => `${String(startLine + i).padStart(6, ' ')}  ${line}`)
    .join('\n');
}
