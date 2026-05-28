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
 * FileEditTool - Types
 * 对标CC FileEditTool types.ts
 * 文件编辑操作类型定义
 */

export type EditOperation =
  | 'insert'
  | 'delete'
  | 'replace'
  | 'append'
  | 'prepend';

export interface EditRange {
  startLine: number;
  endLine: number;
  startCol?: number;
  endCol?: number;
}

export interface EditCommand {
  type: EditOperation;
  path: string;
  range?: EditRange;
  content?: string;
  searchText?: string;
  replaceText?: string;
  insertAtLine?: number;
}

export interface EditResult {
  success: boolean;
  path: string;
  operation: EditOperation;
  originalContent?: string;
  newContent?: string;
  diff?: string;
  error?: string;
  lineChanges?: number;
  charChanges?: number;
}

export interface EditValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface EditOptions {
  dryRun?: boolean;
  createBackup?: boolean;
  preservePermissions?: boolean;
  encoding?: BufferEncoding;
  trailingNewline?: boolean;
  normalizeWhitespace?: boolean;
}

export type BufferEncoding =
  | 'utf-8'
  | 'ascii'
  | 'utf-16le'
  | 'latin1'
  | 'base64'
  | 'hex';

export interface FileSnapshot {
  path: string;
  content: string;
  hash: string;
  timestamp: number;
  size: number;
}

export interface EditHistoryEntry {
  id: string;
  timestamp: number;
  command: EditCommand;
  result: EditResult;
  previousSnapshot?: FileSnapshot;
}

export interface BatchEditCommand {
  edits: EditCommand[];
  options?: EditOptions;
  continueOnError?: boolean;
  rollbackOnFailure?: boolean;
}

export interface BatchEditResult {
  success: boolean;
  results: EditResult[];
  totalLineChanges: number;
  totalCharChanges: number;
  errorCount: number;
  successCount: number;
  duration: number;
}

export function createEditCommand(
  type: EditOperation,
  path: string,
  params: Partial<EditCommand>
): EditCommand {
  return {
    type,
    path,
    ...params,
    range: params.range,
    content: params.content,
    searchText: params.searchText,
    replaceText: params.replaceText,
    insertAtLine: params.insertAtLine,
  };
}

export function validateEditCommand(cmd: EditCommand): EditValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!cmd.path) {
    errors.push('Path is required');
  }

  if (!cmd.type) {
    errors.push('Edit operation type is required');
  } else {
    const validTypes: EditOperation[] = [
      'insert',
      'delete',
      'replace',
      'append',
      'prepend',
    ];
    if (!validTypes.includes(cmd.type)) {
      errors.push(
        `Invalid edit operation: ${cmd.type}. Valid: ${validTypes.join(', ')}`
      );
    }
  }

  if (cmd.type === 'replace' && !cmd.searchText) {
    errors.push('searchText is required for replace operation');
  }

  if (cmd.type === 'insert' && cmd.insertAtLine === undefined) {
    errors.push('insertAtLine is required for insert operation');
  }

  if ((cmd.type === 'append' || cmd.type === 'prepend') && !cmd.content) {
    errors.push('content is required for append/prepend operation');
  }

  if (cmd.range) {
    if (cmd.range.startLine < 1) {
      warnings.push('startLine should be >= 1');
    }
    if (cmd.range.endLine < cmd.range.startLine) {
      errors.push('endLine must be >= startLine');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function formatEditSummary(result: EditResult): string {
  const parts: string[] = [
    result.success ? '✅' : '❌',
    result.operation.toUpperCase(),
    result.path,
  ];

  if (result.lineChanges !== undefined) {
    parts.push(`(${result.lineChanges} lines, ${result.charChanges} chars)`);
  }

  if (result.error) {
    parts.push(`- ${result.error}`);
  }

  return parts.join(' ');
}

export function createEmptyEditResult(path: string, error: string): EditResult {
  return {
    success: false,
    path,
    operation: 'replace',
    error,
    lineChanges: 0,
    charChanges: 0,
  };
}
