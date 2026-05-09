/**
 * FileWriteTool - 文件写入工具
 * 基于CC源码 FileWriteTool 模式
 */
import * as fs from 'fs';
import * as path from 'path';

export interface FileWriteInput {
  filePath: string;
  content: string;
}

export interface FileWriteResult {
  type: 'create' | 'update';
  filePath: string;
  sizeBytes: number;
  linesWritten: number;
}

const MAX_FILE_SIZE = 1 * 1024 * 1024 * 1024; // 1 GiB

export function writeFile(input: FileWriteInput): FileWriteResult {
  const resolved = path.resolve(input.filePath);

  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existed = fs.existsSync(resolved);
  if (existed) {
    const stat = fs.statSync(resolved);
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(
        `File too large to overwrite: ${(stat.size / 1024 / 1024).toFixed(1)} MiB`
      );
    }
  }

  fs.writeFileSync(resolved, input.content, 'utf-8');

  const lines = input.content.split('\n').length;

  return {
    type: existed ? 'update' : 'create',
    filePath: resolved,
    sizeBytes: Buffer.byteLength(input.content, 'utf-8'),
    linesWritten: lines,
  };
}
