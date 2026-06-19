/**
 * FileEditTool - 文件编辑工具（SearchReplace模式）
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveOutputDir } from '@modules/core';
import type { FileOperationResult } from '../types/ToolResult';

function resolveFilePath(filePath: string): string {
  return path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(resolveOutputDir(), filePath);
}

export interface FileEditInput {
  filePath: string;
  oldString: string;
  newString: string;
}

export interface FileEditResult extends FileOperationResult {
  linesChanged: number;
  replaced: boolean;
  oldStringFound: boolean;
}

const MAX_FILE_SIZE = 1 * 1024 * 1024 * 1024; // 1 GiB

export function editFile(input: FileEditInput): FileEditResult {
  const resolved = resolveFilePath(input.filePath);

  if (!fs.existsSync(resolved)) {
    throw new AppError(
      `File not found: ${resolved}. Use the Write tool to create new files.`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }

  const stat = fs.statSync(resolved);
  if (stat.size > MAX_FILE_SIZE) {
    throw new AppError(
      `File too large: ${(stat.size / 1024 / 1024).toFixed(1)} MiB`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }

  const content = fs.readFileSync(resolved, 'utf-8');

  const count = countOccurrences(content, input.oldString);
  if (count === 0) {
    return {
      filePath: input.filePath,
      canonicalPath: resolved,
      linesChanged: 0,
      replaced: false,
      oldStringFound: false,
    };
  }

  if (count > 1) {
    throw new AppError(
      `old_string is not unique in file (found ${count} occurrences). ` +
        `Provide a larger string with more surrounding context to make it unique.`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }

  const newContent = content.replace(input.oldString, input.newString);
  fs.writeFileSync(resolved, newContent, 'utf-8');

  const oldLines = input.oldString.split('\n').length;
  const newLines = input.newString.split('\n').length;
  const linesChanged = Math.abs(newLines - oldLines);

  return {
    filePath: input.filePath,
    canonicalPath: resolved,
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

import { BaseTool } from '../BaseTool';
import { ToolTag } from '../types/Tool';
import type {
  ToolParam,
  ToolUseContext,
  ToolCallProgress,
  ToolResult,
} from '../types';
import { createToolResult } from '../types/ToolResult';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

function normalizeQuotes(str: string): string {
  return str.replace(/\u2018|\u2019/g, "'").replace(/\u201c|\u201d/g, '"');
}

export class FileEditTool extends BaseTool {
  name = 'file_edit';
  description = 'Edit a file by replacing text';

  override tags = [ToolTag.FILE, ToolTag.WRITE];

  params: ToolParam[] = [
    {
      name: 'file_path',
      type: 'string',
      description: 'Path to the file',
      required: true,
    },
    {
      name: 'old_string',
      type: 'string',
      description: 'Text to replace',
      required: true,
    },
    {
      name: 'new_string',
      type: 'string',
      description: 'Replacement text',
      required: true,
    },
    {
      name: 'replace_all',
      type: 'boolean',
      description: 'Replace all occurrences of old_string (default: false)',
      required: false,
    },
  ];

  override async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<unknown>> {
    try {
      const oldString = input.old_string as string;
      const newString = input.new_string as string;
      const replaceAll = input.replace_all === true;

      if (!oldString) {
        return createToolResult('old_string is required', {
          newMessages: [
            { role: 'system', content: 'Error: old_string is required' },
          ],
        });
      }

      if (oldString === newString) {
        return createToolResult(
          'No changes to make: old_string and new_string are exactly the same.',
          {
            newMessages: [
              { role: 'system', content: 'Error: No changes to make' },
            ],
          }
        );
      }

      if (replaceAll) {
        const resolved = resolveFilePath(input.file_path as string);
        const content = fs.readFileSync(resolved, 'utf-8');
        const normalizedOld = normalizeQuotes(content).includes(
          normalizeQuotes(oldString)
        )
          ? oldString
          : oldString;
        const newContent = content.replaceAll(normalizedOld, newString);
        fs.writeFileSync(resolved, newContent, 'utf-8');
        return createToolResult(
          { filePath: resolved, replaced: true },
          {
            newMessages: [
              {
                role: 'system',
                content: 'File edited successfully (all occurrences)',
              },
            ],
          }
        );
      }

      const result = editFile({
        filePath: input.file_path as string,
        oldString,
        newString,
      });

      return createToolResult(
        {
          filePath: result.canonicalPath,
          linesChanged: result.linesChanged,
          replaced: result.replaced,
          oldStringFound: result.oldStringFound,
          replaceAll: false,
        },
        {
          newMessages: [
            {
              role: 'system',
              content: `Successfully edited file: ${result.canonicalPath}`,
            },
          ],
          output: `File edited successfully: ${result.canonicalPath}`,
        }
      );
    } catch (error: any) {
      return createToolResult(error.message, {
        newMessages: [{ role: 'system', content: `Error: ${error.message}` }],
      });
    }
  }
}
