/**
 * 文件编辑工具
 */

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolContext } from '../../core/types';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export class FileEditTool extends BaseTool {
  name = 'file_edit';
  description = 'Edit a file by replacing text';

  schema = {
    name: 'file_edit',
    description: 'Edit a file by replacing text',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file',
        },
        old_string: {
          type: 'string',
          description: 'Text to replace',
        },
        new_string: {
          type: 'string',
          description: 'Replacement text',
        },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  };

  async execute(args: any, context: ToolContext): Promise<ToolResult> {
    try {
      const filePath = resolve(context.cwd, args.file_path);

      if (!existsSync(filePath)) {
        return {
          success: false,
          error: `File not found: ${filePath}`,
        };
      }

      let content = readFileSync(filePath, 'utf-8');

      if (!content.includes(args.old_string)) {
        return {
          success: false,
          error: 'Old string not found in file',
        };
      }

      content = content.replace(args.old_string, args.new_string);
      writeFileSync(filePath, content, 'utf-8');

      return {
        success: true,
        output: `File edited successfully: ${filePath}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
