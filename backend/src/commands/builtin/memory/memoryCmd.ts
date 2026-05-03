/**
 * /memory 命令 - 记忆文件管理
 * 查看、编辑、刷新 MEMORY.md 文件
 */
import * as fs from 'fs';
import * as path from 'path';
import { truncateMemoryContent, MAX_MEMORY_LINES, MAX_MEMORY_BYTES } from '../../../memory/MemoryTruncation';
import { getMemoryFreshness } from '../../../memory/MemoryFreshness';
import { isAutoMemoryEnabled, getAutoMemPath } from '../../../memory/AutoMemory';

export interface MemoryCommandResult {
  success: boolean;
  filePath: string;
  exists: boolean;
  content?: string;
  lineCount: number;
  byteCount: number;
  freshness?: string;
  truncated: boolean;
}

export function readMemoryFile(cwd?: string): MemoryCommandResult {
  const filePath = getAutoMemPath(cwd);
  const exists = fs.existsSync(filePath);

  if (!exists) {
    return {
      success: true,
      filePath,
      exists: false,
      lineCount: 0,
      byteCount: 0,
      truncated: false,
    };
  }

  try {
    const stat = fs.statSync(filePath);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const truncated = truncateMemoryContent(raw);

    return {
      success: true,
      filePath,
      exists: true,
      content: truncated.content,
      lineCount: truncated.lineCount,
      byteCount: truncated.byteCount,
      freshness: getMemoryFreshness(filePath, stat.mtimeMs).freshnessNote,
      truncated: truncated.wasLineTruncated || truncated.wasByteTruncated,
    };
  } catch (e: any) {
    return {
      success: false,
      filePath,
      exists: false,
      lineCount: 0,
      byteCount: 0,
      truncated: false,
      freshness: `Error: ${e.message}`,
    };
  }
}

export function updateMemoryFile(content: string, cwd?: string): MemoryCommandResult {
  const filePath = getAutoMemPath(cwd);
  const dir = path.dirname(filePath);

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return readMemoryFile(cwd);
  } catch (e: any) {
    return {
      success: false,
      filePath,
      exists: false,
      lineCount: 0,
      byteCount: 0,
      truncated: false,
      freshness: `Error: ${e.message}`,
    };
  }
}

export function formatMemoryReport(result: MemoryCommandResult): string {
  if (!result.exists) {
    return [
      `Memory file: ${result.filePath}`,
      `Status: NOT FOUND`,
      `Create one with /memory --edit to add project context.`,
    ].join('\n');
  }

  const kb = (result.byteCount / 1024).toFixed(1);
  return [
    `Memory file: ${result.filePath}`,
    `Lines: ${result.lineCount} (max ${MAX_MEMORY_LINES})`,
    `Size:  ${kb} KB (max ${(MAX_MEMORY_BYTES / 1024).toFixed(0)} KB)`,
    `Auto:  ${isAutoMemoryEnabled() ? 'enabled' : 'disabled'}`,
    `Fresh: ${result.freshness || 'unknown'}`,
    result.truncated ? `⚠ Truncated: exceeds limits` : '',
  ].filter(Boolean).join('\n');
}
