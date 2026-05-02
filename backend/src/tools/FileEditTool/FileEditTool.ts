/**
 * FileEditTool - 文件编辑工具（SearchReplace模式）
 * 基于CC源码 FileEditTool 模式
 */
import * as fs from 'fs';
import * as path from 'path';

export interface FileEditInput {
  filePath: string;
  oldString: string;
  newString: string;
}

export interface FileEditResult {
  filePath: string;
  linesChanged: number;
  replaced: boolean;
  oldStringFound: boolean;
}

const MAX_FILE_SIZE = 1 * 1024 * 1024 * 1024; // 1 GiB

export function editFile(input: FileEditInput): FileEditResult {
  const resolved = path.resolve(input.filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}. Use the Write tool to create new files.`);
  }

  const stat = fs.statSync(resolved);
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${(stat.size / 1024 / 1024).toFixed(1)} MiB`);
  }

  const content = fs.readFileSync(resolved, 'utf-8');

  const count = countOccurrences(content, input.oldString);
  if (count === 0) {
    return { filePath: resolved, linesChanged: 0, replaced: false, oldStringFound: false };
  }

  if (count > 1) {
    throw new Error(
      `old_string is not unique in file (found ${count} occurrences). ` +
      `Provide a larger string with more surrounding context to make it unique.`,
    );
  }

  const newContent = content.replace(input.oldString, input.newString);
  fs.writeFileSync(resolved, newContent, 'utf-8');

  const oldLines = input.oldString.split('\n').length;
  const newLines = input.newString.split('\n').length;
  const linesChanged = Math.abs(newLines - oldLines);

  return {
    filePath: resolved,
    linesChanged,
    replaced: true,
    oldStringFound: true,
  };
}

function countOccurrences(str: string, search: string): number {
  if (!search) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}
