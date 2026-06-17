import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { handleError } from '@modules/error/handleError';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 文件系统适配器接口
 */
export interface FileSystemAdapter {
  // 读取文件
  readFile(filePath: string): Promise<string>;

  // 写入文件
  writeFile(filePath: string, content: string): Promise<void>;

  // 删除文件
  deleteFile(filePath: string): Promise<void>;

  // 检查文件是否存在
  fileExists(filePath: string): Promise<boolean>;

  // 读取目录
  readDirectory(directory: string): Promise<string[]>;

  // 确保目录存在
  ensureDirectoryExists(directory: string): Promise<void>;

  // 检查目录是否存在
  directoryExists(directory: string): Promise<boolean>;

  // 删除目录
  deleteDirectory(directory: string, recursive: boolean): Promise<void>;
}

/**
 * 文件系统适配器实现
 */
export class FileSystemAdapterImpl implements FileSystemAdapter {
  /**
   * 读取文件
   * @param filePath 文件路径
   * @returns 文件内容
   */
  async readFile(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      await handleError(error, {
        module: 'memory:fs',
        action: 'read_file',
        context: { filePath },
      });
      throw error;
    }
  }

  /**
   * 写入文件
   * @param filePath 文件路径
   * @param content 文件内容
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    try {
      // 确保目录存在
      await this.ensureDirectoryExists(dirname(filePath));
      await fs.writeFile(filePath, content, 'utf-8');
    } catch (error) {
      await handleError(error, {
        module: 'memory:fs',
        action: 'write_file',
        context: { filePath },
      });
      throw error;
    }
  }

  /**
   * 删除文件
   * @param filePath 文件路径
   */
  async deleteFile(filePath: string): Promise<void> {
    try {
      const exists = await this.fileExists(filePath);
      if (exists) {
        await fs.unlink(filePath);
      }
    } catch (error) {
      await handleError(error, {
        module: 'memory:fs',
        action: 'delete_file',
        context: { filePath },
      });
      throw error;
    }
  }

  /**
   * 检查文件是否存在
   * @param filePath 文件路径
   * @returns 是否存在
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.stat(filePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 读取目录
   * @param directory 目录路径
   * @returns 目录中的文件和子目录列表
   */
  async readDirectory(directory: string): Promise<string[]> {
    try {
      return await fs.readdir(directory);
    } catch (error) {
      await handleError(error, {
        module: 'memory:fs',
        action: 'read_directory',
        context: { directory },
      });
      throw error;
    }
  }

  /**
   * 确保目录存在
   * @param directory 目录路径
   */
  async ensureDirectoryExists(directory: string): Promise<void> {
    try {
      await fs.mkdir(directory, { recursive: true });
    } catch (error) {
      // 忽略目录已存在的错误
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        await handleError(error, {
          module: 'memory:fs',
          action: 'ensure_directory',
          context: { directory },
        });
        throw error;
      }
    }
  }

  /**
   * 检查目录是否存在
   * @param directory 目录路径
   * @returns 是否存在
   */
  async directoryExists(directory: string): Promise<boolean> {
    try {
      const stats = await fs.stat(directory);
      return stats.isDirectory();
    } catch (error) {
      return false;
    }
  }

  /**
   * 删除目录
   * @param directory 目录路径
   * @param recursive 是否递归删除
   */
  async deleteDirectory(directory: string, recursive: boolean): Promise<void> {
    try {
      const exists = await this.directoryExists(directory);
      if (exists) {
        await fs.rm(directory, { recursive, force: true });
      }
    } catch (error) {
      logger.error(
        `Error deleting directory ${directory}`,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * 复制文件
   * @param source 源文件路径
   * @param destination 目标文件路径
   */
  async copyFile(source: string, destination: string): Promise<void> {
    try {
      // 确保目标目录存在
      await this.ensureDirectoryExists(dirname(destination));
      await fs.copyFile(source, destination);
    } catch (error) {
      logger.error(
        `Error copying file from ${source} to ${destination}`,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * 移动文件
   * @param source 源文件路径
   * @param destination 目标文件路径
   */
  async moveFile(source: string, destination: string): Promise<void> {
    try {
      // 确保目标目录存在
      await this.ensureDirectoryExists(dirname(destination));
      await fs.rename(source, destination);
    } catch (error) {
      await handleError(error, {
        module: 'memory:fs',
        action: 'move_file',
        context: { source, destination },
      });
      throw error;
    }
  }

  /**
   * 获取文件信息
   * @param filePath 文件路径
   * @returns 文件信息
   */
  async getFileInfo(filePath: string): Promise<fs.Stats | null> {
    try {
      return await fs.stat(filePath);
    } catch (error) {
      return null;
    }
  }
}
