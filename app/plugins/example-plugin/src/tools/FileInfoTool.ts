/**
 * FileInfoTool 工具实现
 * 获取文件的详细信息
 */

import type {
  Tool,
  ToolUseContext,
  ToolResult,
  ToolParam
} from '../../../src/tools/types';
import { statSync } from 'fs';
import { join } from 'path';

/**
 * 文件信息输入接口
 */
export interface FileInfoInput {
  file_path: string;
}

/**
 * 创建 FileInfoTool 工具
 */
export function createFileInfoTool(): Tool {
  return {
    name: 'file_info',
    description: '获取文件的详细信息',
    params: [
      {
        name: 'file_path',
        description: '文件路径',
        type: 'string',
        required: true
      }
    ],
    isReadOnly: () => true,
    async execute(
      input: FileInfoInput, 
      context: ToolUseContext
    ): Promise<ToolResult> {
      try {
        const filePath = join(context.cwd, input.file_path);
        const stats = statSync(filePath);

        return {
          success: true,
          output: JSON.stringify({
            path: filePath,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            isFile: stats.isFile(),
            isDirectory: stats.isDirectory()
          }, null, 2)
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}

export const FileInfoTool = createFileInfoTool();
