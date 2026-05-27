/**
 * DirSizeTool 工具实现
 * 计算目录的大小
 */

import type {
  Tool,
  ToolUseContext,
  ToolResult,
  ToolParam
} from '../../../src/tools/types';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * 目录大小输入接口
 */
export interface DirSizeInput {
  directory: string;
}

/**
 * 计算目录大小
 */
function calculateSize(dir: string): number {
  let size = 0;
  try {
    const items = readdirSync(dir);
    for (const item of items) {
      const itemPath = join(dir, item);
      const stats = statSync(itemPath);
      if (stats.isFile()) {
        size += stats.size;
      } else if (stats.isDirectory()) {
        size += calculateSize(itemPath);
      }
    }
  } catch {
    // 忽略无法访问的文件
  }
  return size;
}

/**
 * 格式化大小
 */
function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * 创建 DirSizeTool 工具
 */
export function createDirSizeTool(): Tool {
  return {
    name: 'dir_size',
    description: '计算目录的大小',
    params: [
      {
        name: 'directory',
        description: '目录路径',
        type: 'string',
        required: true
      }
    ],
    isReadOnly: () => true,
    async execute(
      input: DirSizeInput, 
      context: ToolUseContext
    ): Promise<ToolResult> {
      try {
        const dirPath = join(context.cwd, input.directory);
        const size = calculateSize(dirPath);

        return {
          success: true,
          output: `目录 ${input.directory} 的大小: ${formatSize(size)}`
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

export const DirSizeTool = createDirSizeTool();
