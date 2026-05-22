/**
 * 文件化记忆系统（Memdir）实现
 * 支持分层记忆模型、记忆文件扫描、相关记忆检索
 */

import { join } from 'path';
import { mkdir, readFile, writeFile, stat, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 记忆类型（来自CC源码）
 */
export enum MemoryType {
  USER = 'user',
  FEEDBACK = 'feedback',
  PROJECT = 'project',
  REFERENCE = 'reference',
}

/**
 * 记忆层级（来自CC源码）
 */
export enum MemoryLayer {
  PROJECT = 'project', // 项目级：CLAUDE.md
  LOCAL = 'local', // 项目级：CLAUDE.local.md
  AUTOMEM = 'automem', // 用户级：~/.pyapp/memory/
  TEAMMEM = 'teammem', // 团队级：共享存储
  USER = 'user', // 用户级：~/.pyapp/CLAUDE.md
}

/**
 * 记忆文件接口（来自CC源码）
 */
export interface MemoryFile {
  /**
   * 文件路径
   */
  path: string;

  /**
   * 记忆类型
   */
  type: MemoryType;

  /**
   * 记忆层级
   */
  layer: MemoryLayer;

  /**
   * 文件内容
   */
  content: string;

  /**
   * 文件大小
   */
  size: number;

  /**
   * 修改时间
   */
  modifiedAt: Date;

  /**
   * 创建时间
   */
  createdAt: Date;

  /**
   * 是否启用
   */
  enabled: boolean;
}

/**
 * 记忆目录配置（来自CC源码）
 */
export interface MemdirConfig {
  /**
   * 入口文件名
   */
  entrypointName: string;

  /**
   * 最大入口文件行数
   */
  maxEntrypointLines: number;

  /**
   * 最大入口文件字节数
   */
  maxEntrypointBytes: number;

  /**
   * 自动记忆基础目录
   */
  autoMemBaseDir: string;

  /**
   * 是否启用自动记忆
   */
  autoMemoryEnabled: boolean;

  /**
   * 团队记忆目录
   */
  teamMemDir?: string;
}

/**
 * 入口点截断结果（来自CC源码）
 */
export interface EntrypointTruncation {
  content: string;
  lineCount: number;
  byteCount: number;
  wasLineTruncated: boolean;
  wasByteTruncated: boolean;
}

/**
 * 记忆目录服务类（基于CC源码实现）
 */
export class MemdirService {
  private config: MemdirConfig;
  private memoryFiles: Map<string, MemoryFile> = new Map();

  constructor(config?: Partial<MemdirConfig>) {
    this.config = {
      entrypointName: 'MEMORY.md',
      maxEntrypointLines: 200,
      maxEntrypointBytes: 25000,
      autoMemBaseDir: join(homedir(), '.pyapp', 'memory'),
      autoMemoryEnabled: true,
      ...config,
    };
  }

  /**
   * 初始化记忆目录（来自CC源码）
   */
  async initialize(): Promise<void> {
    try {
      // 确保记忆目录存在
      await this.ensureMemoryDirExists();

      // 扫描所有记忆文件
      await this.scanMemoryFiles();

      logger.info('Memdir service initialized successfully');
    } catch (error) {
      logger.error(
        'Failed to initialize memdir service',
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * 确保记忆目录存在（来自CC源码）
   */
  private async ensureMemoryDirExists(): Promise<void> {
    try {
      await mkdir(this.config.autoMemBaseDir, { recursive: true });
    } catch (error) {
      logger.error(
        `Failed to create memory directory`,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * 扫描记忆文件（来自CC源码）
   */
  private async scanMemoryFiles(): Promise<void> {
    try {
      // 扫描项目级记忆文件
      await this.scanProjectMemoryFiles();

      // 扫描用户级记忆文件
      await this.scanUserMemoryFiles();

      // 扫描自动记忆文件
      if (this.config.autoMemoryEnabled) {
        await this.scanAutoMemoryFiles();
      }

      // 扫描团队记忆文件（如果配置）
      if (this.config.teamMemDir) {
        await this.scanTeamMemoryFiles();
      }

      logger.info(`Scanned ${this.memoryFiles.size} memory files`);
    } catch (error) {
      logger.error(
        'Failed to scan memory files',
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * 扫描项目级记忆文件（来自CC源码）
   */
  private async scanProjectMemoryFiles(): Promise<void> {
    const projectFiles = [
      'CLAUDE.md', // 项目约定
      'CLAUDE.local.md', // 个人项目指令
    ];

    for (const fileName of projectFiles) {
      const filePath = join(process.cwd(), fileName);

      if (existsSync(filePath)) {
        try {
          const content = await readFile(filePath, 'utf-8');
          const stats = await stat(filePath);

          const memoryFile: MemoryFile = {
            path: filePath,
            type:
              fileName === 'CLAUDE.md' ? MemoryType.PROJECT : MemoryType.USER,
            layer:
              fileName === 'CLAUDE.md'
                ? MemoryLayer.PROJECT
                : MemoryLayer.LOCAL,
            content,
            size: stats.size,
            modifiedAt: stats.mtime,
            createdAt: stats.birthtime,
            enabled: true,
          };

          this.memoryFiles.set(filePath, memoryFile);
        } catch (error) {
          logger.warning(
            `Failed to read project memory file ${filePath}`,
            error instanceof Error ? error : new Error(String(error))
          );
        }
      }
    }
  }

  /**
   * 扫描用户级记忆文件（来自CC源码）
   */
  private async scanUserMemoryFiles(): Promise<void> {
    const userMemDir = join(homedir(), '.pyapp');
    const userFile = join(userMemDir, 'CLAUDE.md');

    if (existsSync(userFile)) {
      try {
        const content = await readFile(userFile, 'utf-8');
        const stats = await stat(userFile);

        const memoryFile: MemoryFile = {
          path: userFile,
          type: MemoryType.USER,
          layer: MemoryLayer.USER,
          content,
          size: stats.size,
          modifiedAt: stats.mtime,
          createdAt: stats.birthtime,
          enabled: true,
        };

        this.memoryFiles.set(userFile, memoryFile);
      } catch (error) {
        logger.warning(
          `Failed to read user memory file ${userFile}`,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  }

  /**
   * 扫描自动记忆文件（来自CC源码）
   */
  private async scanAutoMemoryFiles(): Promise<void> {
    try {
      if (!existsSync(this.config.autoMemBaseDir)) {
        return;
      }

      const files = await readdir(this.config.autoMemBaseDir);

      for (const fileName of files) {
        if (fileName.endsWith('.md')) {
          const filePath = join(this.config.autoMemBaseDir, fileName);

          try {
            const content = await readFile(filePath, 'utf-8');
            const stats = await stat(filePath);

            const memoryFile: MemoryFile = {
              path: filePath,
              type: this.detectMemoryType(fileName, content),
              layer: MemoryLayer.AUTOMEM,
              content,
              size: stats.size,
              modifiedAt: stats.mtime,
              createdAt: stats.birthtime,
              enabled: true,
            };

            this.memoryFiles.set(filePath, memoryFile);
          } catch (error) {
            logger.warning(
              `Failed to read auto memory file ${filePath}`,
              error instanceof Error ? error : new Error(String(error))
            );
          }
        }
      }
    } catch (error) {
      logger.warning(
        'Failed to scan auto memory files',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * 扫描团队记忆文件（来自CC源码）
   */
  private async scanTeamMemoryFiles(): Promise<void> {
    if (!this.config.teamMemDir || !existsSync(this.config.teamMemDir)) {
      return;
    }

    try {
      const files = await readdir(this.config.teamMemDir);

      for (const fileName of files) {
        if (fileName.endsWith('.md')) {
          const filePath = join(this.config.teamMemDir, fileName);

          try {
            const content = await readFile(filePath, 'utf-8');
            const stats = await stat(filePath);

            const memoryFile: MemoryFile = {
              path: filePath,
              type: MemoryType.REFERENCE,
              layer: MemoryLayer.TEAMMEM,
              content,
              size: stats.size,
              modifiedAt: stats.mtime,
              createdAt: stats.birthtime,
              enabled: true,
            };

            this.memoryFiles.set(filePath, memoryFile);
          } catch (error) {
            logger.warning(
              `Failed to read team memory file ${filePath}`,
              error instanceof Error ? error : new Error(String(error))
            );
          }
        }
      }
    } catch (error) {
      logger.warning(
        'Failed to scan team memory files',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * 检测记忆类型（来自CC源码）
   */
  private detectMemoryType(fileName: string, content: string): MemoryType {
    if (fileName.includes('feedback')) {
      return MemoryType.FEEDBACK;
    }

    if (fileName.includes('project')) {
      return MemoryType.PROJECT;
    }

    if (fileName.includes('reference')) {
      return MemoryType.REFERENCE;
    }

    return MemoryType.USER;
  }

  /**
   * 截断入口文件内容（来自CC源码）
   */
  truncateEntrypointContent(raw: string): EntrypointTruncation {
    const trimmed = raw.trim();
    const contentLines = trimmed.split('\n');
    const lineCount = contentLines.length;
    const byteCount = trimmed.length;

    const wasLineTruncated = lineCount > this.config.maxEntrypointLines;
    const wasByteTruncated = byteCount > this.config.maxEntrypointBytes;

    if (!wasLineTruncated && !wasByteTruncated) {
      return {
        content: trimmed,
        lineCount,
        byteCount,
        wasLineTruncated,
        wasByteTruncated,
      };
    }

    let truncated = wasLineTruncated
      ? contentLines.slice(0, this.config.maxEntrypointLines).join('\n')
      : trimmed;

    if (truncated.length > this.config.maxEntrypointBytes) {
      const cutAt = truncated.lastIndexOf('\n', this.config.maxEntrypointBytes);
      truncated = truncated.slice(
        0,
        cutAt > 0 ? cutAt : this.config.maxEntrypointBytes
      );
    }

    const reason =
      wasByteTruncated && !wasLineTruncated
        ? `${this.formatFileSize(byteCount)} (limit: ${this.formatFileSize(this.config.maxEntrypointBytes)}) — index entries are too long`
        : wasLineTruncated && !wasByteTruncated
          ? `${lineCount} lines (limit: ${this.config.maxEntrypointLines})`
          : `${lineCount} lines and ${this.formatFileSize(byteCount)}`;

    return {
      content:
        truncated +
        `\n\n> WARNING: ${this.config.entrypointName} is ${reason}. Only part of it was loaded. Keep index entries to one line under ~200 chars; move detail into topic files.`,
      lineCount,
      byteCount,
      wasLineTruncated,
      wasByteTruncated,
    };
  }

  /**
   * 格式化文件大小（来自CC源码）
   */
  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * 构建记忆行为指令（来自CC源码）
   */
  buildMemoryLines(): string[] {
    const lines: string[] = [];

    // 添加记忆目录存在指导
    lines.push('# Memory Directory Guidance');
    lines.push('');
    lines.push(
      'When a memory directory exists, use it to recall relevant context.'
    );
    lines.push(
      'Search for memories that match the current task or conversation.'
    );
    lines.push('');

    // 添加记忆类型指导
    lines.push('## Memory Types');
    lines.push('- **User**: Personal preferences and instructions');
    lines.push('- **Feedback**: User feedback and improvement suggestions');
    lines.push('- **Project**: Project-specific conventions and patterns');
    lines.push('- **Reference**: Reference materials and documentation');
    lines.push('');

    return lines;
  }

  /**
   * 获取所有记忆文件
   */
  getAllMemoryFiles(): MemoryFile[] {
    return Array.from(this.memoryFiles.values());
  }

  /**
   * 按层级获取记忆文件
   */
  getMemoryFilesByLayer(layer: MemoryLayer): MemoryFile[] {
    return Array.from(this.memoryFiles.values()).filter(
      (file) => file.layer === layer
    );
  }

  /**
   * 按类型获取记忆文件
   */
  getMemoryFilesByType(type: MemoryType): MemoryFile[] {
    return Array.from(this.memoryFiles.values()).filter(
      (file) => file.type === type
    );
  }

  /**
   * 获取特定记忆文件
   */
  getMemoryFile(path: string): MemoryFile | undefined {
    return this.memoryFiles.get(path);
  }

  /**
   * 重新扫描记忆文件
   */
  async rescanMemoryFiles(): Promise<void> {
    this.memoryFiles.clear();
    await this.scanMemoryFiles();
  }
}
