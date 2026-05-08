/**
 * 文件编辑工具（SearchReplace模式）
 * 基于CC源码 cc_code/backend/tools/FileEditTool 优化实现
 */
import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam, ToolCallProgress } from '../types';
import { createToolResult } from '../types/ToolResult';
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { resolve } from 'path';

const MAX_FILE_SIZE = 1 * 1024 * 1024 * 1024; // 1 GiB

/**
 * 规范化引号：将弯引号/智能引号转换为直引号
 */
function normalizeQuotes(str: string): string {
  return str
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"');
}

/**
 * 统计字符串中出现次数
 */
function countOccurrences(content: string, search: string): number {
  if (!search) {return 0;}
  let count = 0;
  let pos = 0;
  while ((pos = content.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}

export class FileEditTool extends BaseTool {
  name = 'file_edit';
  description = 'Edit a file by replacing text';

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

  async execute(
    input: Record<string, unknown>,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<unknown>> {
    try {
      const filePath = resolve(
        context.options?.cwd || process.cwd(),
        input.file_path as string
      );
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
        return createToolResult('No changes to make: old_string and new_string are exactly the same.', {
          newMessages: [
            { role: 'system', content: 'Error: No changes to make: old_string and new_string are exactly the same.' },
          ],
        });
      }

      if (!existsSync(filePath)) {
        return createToolResult(`File does not exist: ${filePath}. Use the Write tool to create new files.`, {
          newMessages: [
            { role: 'system', content: `Error: File does not exist: ${filePath}. Use the Write tool to create new files.` },
          ],
        });
      }

      const fileStat = statSync(filePath);
      if (fileStat.size > MAX_FILE_SIZE) {
        const sizeMB = (fileStat.size / 1024 / 1024).toFixed(1);
        return createToolResult(`File too large: ${sizeMB} MiB. Maximum editable file size is 1 GiB.`, {
          newMessages: [
            { role: 'system', content: `Error: File too large: ${sizeMB} MiB. Maximum editable file size is 1 GiB.` },
          ],
        });
      }

      const content = readFileSync(filePath, 'utf-8');

      // 尝试标准化引号匹配
      const actualOldString = normalizeQuotes(content).includes(normalizeQuotes(oldString))
        ? oldString
        : oldString;

      const count = countOccurrences(content, actualOldString);
      if (count === 0) {
        return createToolResult(`String to replace not found in file: ${oldString}`, {
          newMessages: [
            { role: 'system', content: `Error: String to replace not found in file: ${oldString}` },
          ],
        });
      }

      if (count > 1 && !replaceAll) {
        return createToolResult(
          `old_string is not unique in file (found ${count} occurrences). ` +
          `To replace all occurrences, set replace_all to true. ` +
          `To replace only one, provide a larger string with more surrounding context.`,
          {
            newMessages: [
              { role: 'system', content: `Error: old_string is not unique in file (found ${count} occurrences).` },
            ],
          }
        );
      }

      const newContent = replaceAll
        ? content.replaceAll(actualOldString, newString)
        : content.replace(actualOldString, newString);

      writeFileSync(filePath, newContent, 'utf-8');

      const oldLines = actualOldString.split('\n').length;
      const newLineCount = newString.split('\n').length;
      const linesChanged = Math.abs(newLineCount - oldLines);

      return createToolResult({
        filePath,
        linesChanged,
        replaced: true,
        oldStringFound: true,
        replaceAll,
      } as const, {
        newMessages: [
          {
            role: 'system',
            content: `Successfully edited file: ${filePath}${replaceAll ? ' (replaced all occurrences)' : ''}`,
          },
        ],
        output: `File edited successfully: ${filePath}`,
      });
    } catch (error: any) {
      return createToolResult(error.message, {
        newMessages: [
          { role: 'system', content: `Error: ${error.message}` },
        ],
      });
    }
  }
}
