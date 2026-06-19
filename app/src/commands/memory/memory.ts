/**
 * Memory命令执行逻辑
 * 处理记忆文件编辑
 * 参考CC源码 cc_code/backend/commands/memory/memory.tsx 实现
 */

import type { CommandContext, CommandResult } from '@modules/commands';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { resolvePyappHome } from '@modules/core';

/**
 * 获取记忆文件目录
 */
function getMemoryDir(): string {
  return join(resolvePyappHome(), 'memory');
}

/**
 * 获取可用的记忆文件列表
 */
async function getMemoryFiles(): Promise<string[]> {
  const memoryDir = getMemoryDir();

  if (!existsSync(memoryDir)) {
    return [];
  }

  try {
    const { readdir } = await import('fs/promises');
    const files = await readdir(memoryDir);
    return files.filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

/**
 * 读取记忆文件内容
 */
async function readMemoryFile(filename: string): Promise<string> {
  const memoryDir = getMemoryDir();
  const filePath = join(memoryDir, filename);

  try {
    const content = await readFile(filePath, 'utf8');
    return content;
  } catch {
    return '';
  }
}

/**
 * 写入记忆文件
 */
async function writeMemoryFile(
  filename: string,
  content: string
): Promise<void> {
  const memoryDir = getMemoryDir();

  // 确保目录存在
  await mkdir(memoryDir, { recursive: true });

  const filePath = join(memoryDir, filename);
  await writeFile(filePath, content, 'utf8');
}

/**
 * 执行memory命令
 */
export async function executeMemory(
  args: string,
  _context: CommandContext
): Promise<CommandResult> {
  try {
    const params = parseMemoryArgs(args);

    // 如果没有指定文件，列出所有记忆文件
    if (!params.file) {
      const files = await getMemoryFiles();

      if (files.length === 0) {
        return {
          type: 'text',
          success: true,
          message:
            '没有找到记忆文件。使用 /memory <filename> 创建或编辑记忆文件。',
        };
      }

      return {
        type: 'text',
        success: true,
        message: `可用的记忆文件:\n${files.map((f) => `  - ${f}`).join('\n')}`,
      };
    }

    // 确保文件名以.md结尾
    const filename = params.file.endsWith('.md')
      ? params.file
      : `${params.file}.md`;

    // 读取现有内容
    const existingContent = await readMemoryFile(filename);

    // 如果有--content参数，直接写入
    if (params.content !== undefined) {
      await writeMemoryFile(filename, params.content);
      return {
        type: 'text',
        success: true,
        message: `记忆文件 ${filename} 已更新`,
      };
    }

    // 返回文件内容（用于编辑）
    return {
      type: 'text',
      success: true,
      message: existingContent
        ? `记忆文件 ${filename}:\n\n${existingContent}`
        : `记忆文件 ${filename} 不存在。将创建新文件。`,
      data: {
        filename,
        content: existingContent,
        exists: !!existingContent,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      type: 'error',
      success: false,
      message: `操作记忆文件失败: ${errorMessage}`,
    };
  }
}

/**
 * 解析memory命令参数
 */
function parseMemoryArgs(args: string): {
  file?: string;
  content?: string;
} {
  const params: {
    file?: string;
    content?: string;
  } = {};

  if (!args) return params;

  const parts = args.trim().split(/\s+/);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part === '--content' || part === '-c') {
      // 获取剩余所有内容
      params.content = parts.slice(i + 1).join(' ');
      break;
    } else if (!part.startsWith('-') && !params.file) {
      params.file = part;
    }
  }

  return params;
}
