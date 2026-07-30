import { promises as fs } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import type { Memory } from '../types/Memory';
import { createMemoryMetadata } from '../types/MemoryMetadata';
import { isValidMemoryType } from '../types/MemoryType';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'memory:scanners:memoryScanner',
  level: LogLevel.INFO,
});

/**
 * 记忆扫描器接口
 */
export interface MemoryScanner {
  // 扫描记忆目录
  scan(directory: string): Promise<Memory[]>;

  // 按类型扫描记忆目录
  scanByType(directory: string, type: string): Promise<Memory[]>;

  // 解析记忆文件
  parseMemoryFile(filePath: string): Promise<Memory | null>;

  // 验证记忆格式
  validateMemory(memory: Memory): boolean;

  // 提取记忆元数据
  extractMetadata(content: string): unknown;
}

/**
 * 记忆扫描器实现
 */
export class MemoryScannerImpl implements MemoryScanner {
  /**
   * 扫描记忆目录
   * @param directory 记忆目录路径
   * @returns 记忆列表
   */
  async scan(directory: string): Promise<Memory[]> {
    const memories: Memory[] = [];

    try {
      // 检查目录是否存在
      const exists = await fs
        .stat(directory)
        .then(() => true)
        .catch(() => false);
      if (!exists) {
        return memories;
      }

      // 读取目录内容
      const files = await fs.readdir(directory);

      // 过滤出.md文件并排除MEMORY.md
      const memoryFiles = files.filter(
        (file) => file.endsWith('.md') && file !== 'MEMORY.md'
      );

      // 解析每个记忆文件
      for (const file of memoryFiles) {
        const filePath = join(directory, file);
        const memory = await this.parseMemoryFile(filePath);
        if (memory && this.validateMemory(memory)) {
          memories.push(memory);
        }
      }
    } catch (error) {
      await handleError(error, {
        module: 'memory:scanners:scanner',
        action: 'scan_directory',
      });
    }

    return memories;
  }

  /**
   * 按类型扫描记忆目录
   * @param directory 记忆目录路径
   * @param type 记忆类型
   * @returns 指定类型的记忆列表
   */
  async scanByType(directory: string, type: string): Promise<Memory[]> {
    const allMemories = await this.scan(directory);
    return allMemories.filter((memory) => memory.metadata.type === type);
  }

  /**
   * 解析记忆文件
   * @param filePath 记忆文件路径
   * @returns 记忆对象或null
   */
  async parseMemoryFile(filePath: string): Promise<Memory | null> {
    try {
      // 读取文件内容
      const content = await fs.readFile(filePath, 'utf-8');

      // 解析frontmatter
      const { data, content: memoryContent } = matter(content);

      // 构建记忆对象
      const memory: Memory = {
        id: data.id || filePath.split('\\').pop()?.replace('.md', '') || '',
        content: memoryContent.trim(),
        metadata: createMemoryMetadata({
          name: data.name || 'Untitled Memory',
          description: data.description || '',
          type: data.type || 'user',
          createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
          updatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date(),
          tags: data.tags || [],
          priority: data.priority,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
          author: data.author,
          source: data.source,
        }),
        createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
        updatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date(),
      };

      return memory;
    } catch (error) {
      await handleError(error, {
        module: 'memory:scanners:scanner',
        action: 'parse_memory_file',
        context: { filePath },
      });
      return null;
    }
  }

  /**
   * 验证记忆格式
   * @param memory 记忆对象
   * @returns 是否有效
   */
  validateMemory(memory: Memory): boolean {
    // 验证ID
    if (!memory.id || memory.id.trim() === '') {
      return false;
    }

    // 验证内容
    if (memory.content === undefined || memory.content === null) {
      return false;
    }

    // 验证元数据
    if (!memory.metadata) {
      return false;
    }

    // 验证记忆类型
    if (!isValidMemoryType(memory.metadata.type)) {
      return false;
    }

    // 验证时间戳
    if (
      !(memory.createdAt instanceof Date) ||
      isNaN(memory.createdAt.getTime())
    ) {
      return false;
    }

    if (
      !(memory.updatedAt instanceof Date) ||
      isNaN(memory.updatedAt.getTime())
    ) {
      return false;
    }

    return true;
  }

  /**
   * 提取记忆元数据
   * @param content 文件内容
   * @returns 元数据对象
   */
  async extractMetadata(content: string): Promise<any> {
    try {
      const { data } = matter(content);
      return data;
    } catch (error) {
      await handleError(error, {
        module: 'memory:scanners:scanner',
        action: 'extract_metadata',
      });
      return {};
    }
  }

  /**
   * 扫描单个文件
   * @param filePath 文件路径
   * @returns 记忆对象或null
   */
  async scanFile(filePath: string): Promise<Memory | null> {
    return this.parseMemoryFile(filePath);
  }

  /**
   * 扫描多个文件
   * @param filePaths 文件路径列表
   * @returns 记忆列表
   */
  async scanFiles(filePaths: string[]): Promise<Memory[]> {
    const memories: Memory[] = [];

    for (const filePath of filePaths) {
      const memory = await this.parseMemoryFile(filePath);
      if (memory && this.validateMemory(memory)) {
        memories.push(memory);
      }
    }

    return memories;
  }
}
