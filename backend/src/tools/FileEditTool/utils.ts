/**
 * FileEditTool - Utils
 * 对标CC FileEditTool utils.ts
 * 文件编辑工具函数
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  type EditCommand,
  type EditResult,
  type EditOptions,
  type EditValidation,
  type FileSnapshot,
  type EditHistoryEntry,
  type BatchEditCommand,
  type BatchEditResult,
  validateEditCommand,
} from './types';

const DEFAULT_OPTIONS: Required<EditOptions> = {
  dryRun: false,
  createBackup: false,
  preservePermissions: true,
  encoding: 'utf-8',
  trailingNewline: true,
  normalizeWhitespace: false,
};

export function readFileContent(filePath: string, encoding: BufferEncoding = 'utf-8'): string {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  return readFileSync(filePath, { encoding });
}

export function writeFileContent(filePath: string, content: string, encoding: BufferEncoding = 'utf-8'): void {
  writeFileSync(filePath, content, { encoding });
}

export function computeHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

export function takeSnapshot(filePath: string): FileSnapshot {
  const content = readFileContent(filePath);
  const stat = statSync(filePath);

  return {
    path: filePath,
    content,
    hash: computeHash(content),
    timestamp: Date.now(),
    size: stat.size,
  };
}

export function generateDiff(original: string, modified: string): string {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');
  const diff: string[] = [];

  let added = 0;
  let removed = 0;

  for (let i = 0; i < Math.max(origLines.length, modLines.length); i++) {
    if (i >= origLines.length) {
      diff.push(`+ ${modLines[i]}`);
      added++;
    } else if (i >= modLines.length) {
      diff.push(`- ${origLines[i]}`);
      removed++;
    } else if (origLines[i] !== modLines[i]) {
      diff.push(`- ${origLines[i]}`);
      diff.push(`+ ${modLines[i]}`);
      added++;
      removed++;
    }
  }

  return diff.join('\n');
}

export async function applyEdit(
  command: EditCommand,
  options?: EditOptions,
): Promise<EditResult> {
  const opts: Required<EditOptions> = { ...DEFAULT_OPTIONS, ...options };
  const validation = validateEditCommand(command);

  if (!validation.valid) {
    return {
      success: false,
      path: command.path,
      operation: command.type,
      error: validation.errors.join('; '),
    };
  }

  try {
    const originalContent = readFileContent(command.path, opts.encoding);
    let newContent: string;

    switch (command.type) {
      case 'insert':
        newContent = applyInsert(originalContent, command);
        break;
      case 'delete':
        newContent = applyDelete(originalContent, command);
        break;
      case 'replace':
        newContent = applyReplace(originalContent, command);
        break;
      case 'append':
        newContent = originalContent + (command.content ?? '');
        break;
      case 'prepend':
        newContent = (command.content ?? '') + originalContent;
        break;
      default:
        return {
          success: false,
          path: command.path,
          operation: command.type,
          error: `Unsupported operation: ${command.type}`,
        };
    }

    if (opts.trailingNewline && !newContent.endsWith('\n')) {
      newContent += '\n';
    }

    if (opts.normalizeWhitespace) {
      newContent = newContent.replace(/\r\n/g, '\n').replace(/\t/g, '  ');
    }

    const charChanges = Math.abs(newContent.length - originalContent.length);
    const lineChanges = Math.abs(newContent.split('\n').length - originalContent.split('\n').length);
    const diff = generateDiff(originalContent, newContent);

    if (!opts.dryRun) {
      writeFileContent(command.path, newContent, opts.encoding);
    }

    return {
      success: true,
      path: command.path,
      operation: command.type,
      originalContent: opts.dryRun ? originalContent : undefined,
      newContent: opts.dryRun ? newContent : undefined,
      diff,
      lineChanges,
      charChanges,
    };
  } catch (error: any) {
    return {
      success: false,
      path: command.path,
      operation: command.type,
      error: error.message ?? String(error),
    };
  }
}

export async function applyBatchEdits(
  batch: BatchEditCommand,
): Promise<BatchEditResult> {
  const startTime = Date.now();
  const results: EditResult[] = [];
  let successCount = 0;
  let errorCount = 0;

  const snapshots: Map<string, FileSnapshot> = new Map();

  for (const edit of batch.edits) {
    if (!snapshots.has(edit.path)) {
      try {
        snapshots.set(edit.path, takeSnapshot(edit.path));
      } catch {
        // File may not exist yet
      }
    }
  }

  for (const edit of batch.edits) {
    try {
      const result = await applyEdit(edit, batch.options);

      if (result.success) {
        successCount++;
      } else {
        errorCount++;

        if (!batch.continueOnError && batch.rollbackOnFailure) {
          for (const [path, snapshot] of snapshots) {
            try {
              writeFileContent(path, snapshot.content);
            } catch {
              // Rollback silently
            }
          }

          const duration = Date.now() - startTime;
          return {
            success: false,
            results: [...results, result],
            totalLineChanges: results.reduce((s, r) => s + (r.lineChanges ?? 0), 0),
            totalCharChanges: results.reduce((s, r) => s + (r.charChanges ?? 0), 0),
            errorCount: errorCount,
            successCount,
            duration,
          };
        }

        if (!batch.continueOnError) {
          const duration = Date.now() - startTime;
          return {
            success: false,
            results: [...results, result],
            totalLineChanges: results.reduce((s, r) => s + (r.lineChanges ?? 0), 0),
            totalCharChanges: results.reduce((s, r) => s + (r.charChanges ?? 0), 0),
            errorCount,
            successCount,
            duration,
          };
        }
      }

      results.push(result);
    } catch (error: any) {
      errorCount++;

      results.push({
        success: false,
        path: edit.path,
        operation: edit.type,
        error: error.message ?? String(error),
      });

      if (!batch.continueOnError) break;
    }
  }

  const duration = Date.now() - startTime;
  return {
    success: errorCount === 0,
    results,
    totalLineChanges: results.reduce((s, r) => s + (r.lineChanges ?? 0), 0),
    totalCharChanges: results.reduce((s, r) => s + (r.charChanges ?? 0), 0),
    errorCount,
    successCount,
    duration,
  };
}

function applyInsert(content: string, command: EditCommand): string {
  const lines = content.split('\n');
  const insertLine = command.insertAtLine ?? 1;

  if (insertLine < 1 || insertLine > lines.length + 1) {
    throw new Error(`Insert position ${insertLine} out of range (1-${lines.length + 1})`);
  }

  lines.splice(insertLine - 1, 0, command.content ?? '');
  return lines.join('\n');
}

function applyDelete(content: string, command: EditCommand): string {
  const lines = content.split('\n');
  const range = command.range;

  if (!range) {
    throw new Error('Range is required for delete operation');
  }

  if (range.startLine < 1 || range.endLine > lines.length) {
    throw new Error(`Delete range ${range.startLine}-${range.endLine} out of range (1-${lines.length})`);
  }

  lines.splice(range.startLine - 1, range.endLine - range.startLine + 1);
  return lines.join('\n');
}

function applyReplace(content: string, command: EditCommand): string {
  if (command.searchText) {
    const escaped = command.searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    return content.replace(regex, command.replaceText ?? '');
  }

  if (command.range) {
    const lines = content.split('\n');
    const range = command.range;

    if (range.startLine < 1 || range.endLine > lines.length) {
      throw new Error(`Replace range ${range.startLine}-${range.endLine} out of range (1-${lines.length})`);
    }

    lines.splice(range.startLine - 1, range.endLine - range.startLine + 1, command.content ?? '');
    return lines.join('\n');
  }

  throw new Error('Either searchText or range is required for replace operation');
}
