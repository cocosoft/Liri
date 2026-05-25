import { promises as fs, constants } from 'fs';
import fsExtra from 'fs-extra';
import { join, dirname, basename, resolve, normalize } from 'path';
import matter from 'gray-matter';
import { glob } from 'glob';
import type { Memory } from '../types/Memory';
import { createMemoryMetadata } from '../types/MemoryMetadata';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { resolveMemoryDir } from '../../config/paths';

const storeLogger = new Logger({ level: LogLevel.INFO });

/**
 * 验证记忆ID安全性
 * 防御路径注入攻击：拒绝路径遍历、路径分隔符、Windows驱动根、null字节
 * @param id 记忆ID
 * @throws AppError 如果不安全
 */
export function validateMemoryId(id: string): void {
  if (id.includes('..')) {
    storeLogger.warn('Path traversal detected in memoryId', { id });
    throw new AppError(
      'Invalid memory ID: path traversal detected',
      ErrorCategory.PERMISSION,
      ErrorSeverity.HIGH,
      'MEMORY_PATH_TRAVERSAL',
      { id }
    );
  }

  if (id.includes('/') || id.includes('\\')) {
    storeLogger.warn('Path separator detected in memoryId', { id });
    throw new AppError(
      'Invalid memory ID: contains path separator',
      ErrorCategory.PERMISSION,
      ErrorSeverity.HIGH,
      'MEMORY_ID_SEPARATOR',
      { id }
    );
  }

  if (/^[A-Za-z]:/.test(id)) {
    storeLogger.warn('Drive root detected in memoryId', { id });
    throw new AppError(
      'Invalid memory ID: contains drive root',
      ErrorCategory.PERMISSION,
      ErrorSeverity.HIGH,
      'MEMORY_ID_DRIVE_ROOT',
      { id }
    );
  }

  if (id.includes('\0')) {
    storeLogger.warn('Null byte detected in memoryId', { id });
    throw new AppError(
      'Invalid memory ID: contains null byte',
      ErrorCategory.PERMISSION,
      ErrorSeverity.HIGH,
      'MEMORY_ID_NULL_BYTE',
      { id }
    );
  }
}

/**
 * 验证记忆路径安全性（用于文件路径参数）
 * 防御路径注入：拒绝路径遍历和null字节
 * @param input 文件路径
 * @param fieldName 字段名（用于错误信息）
 * @throws AppError 如果不安全
 */
export function validateMemoryPath(
  input: string,
  fieldName: string = 'path'
): void {
  if (input.includes('..')) {
    storeLogger.warn(`Path traversal detected in ${fieldName}`, { input });
    throw new AppError(
      `Invalid ${fieldName}: path traversal detected`,
      ErrorCategory.PERMISSION,
      ErrorSeverity.HIGH,
      'MEMORY_PATH_TRAVERSAL',
      { fieldName, input }
    );
  }

  if (input.includes('\0')) {
    storeLogger.warn(`Null byte detected in ${fieldName}`, { input });
    throw new AppError(
      `Invalid ${fieldName}: null byte detected`,
      ErrorCategory.PERMISSION,
      ErrorSeverity.HIGH,
      'MEMORY_PATH_NULL_BYTE',
      { fieldName, input }
    );
  }
}

/**
 * 记忆存储后端接口
 * 在默认文件存储之外，支持注册替代存储后端（如数据库、向量存储等）
 */
export interface MemoryStoreBackend {
  name: string;
  save(id: string, data: Memory): Promise<void>;
  read(id: string): Promise<Memory | null>;
  delete(id: string): Promise<void>;
  list(): Promise<string[]>;
}

/**
 * 记忆存储接口
 */
export interface MemoryStore {
  // 保存记忆
  saveMemory(memory: Memory): Promise<void>;

  // 读取记忆
  readMemory(id: string): Promise<Memory | null>;

  // 删除记忆
  deleteMemory(id: string): Promise<void>;

  // 列出所有记忆
  listMemories(): Promise<string[]>;

  // 确保记忆目录存在
  ensureMemoryDirExists(): Promise<void>;

  // 读取记忆索引
  readMemoryIndex(): Promise<string>;

  // 更新记忆索引
  updateMemoryIndex(): Promise<void>;

  // 导出记忆为Markdown文件
  exportMemoryAsMarkdown(id: string, exportDir?: string): Promise<string>;

  // 导入Markdown文件为记忆
  importMemoryFromMarkdown(filePath: string): Promise<string>;

  // 获取记忆的Markdown预览
  getMemoryMarkdownPreview(id: string): Promise<string>;

  // 注册替代存储后端
  registerStoreBackend(name: string, backend: MemoryStoreBackend): void;

  // 获取已注册的后端列表
  getRegisteredBackends(): string[];
}

/**
 * 记忆存储实现
 */
export class MemoryStoreImpl implements MemoryStore {
  /**
   * 记忆目录路径
   */
  private memoryDir: string;

  /**
   * 已注册的替代存储后端
   * 对标 OpenClaw plugin-based store backend 架构
   */
  private backends: Map<string, MemoryStoreBackend> = new Map();

  /**
   * LRU 记忆缓存，按访问顺序存储最近使用的记忆
   */
  private memoryCache: Map<string, Memory> = new Map();

  /**
   * 缓存最大条目数
   */
  private readonly MAX_CACHE_SIZE = 100;

  /**
   * 向量索引文件路径
   */
  private getVectorIndexPath(): string {
    return join(this.memoryDir, 'memory-vectors.json');
  }

  /**
   * 构造函数
   * @param memoryDir 记忆目录路径
   */
  constructor(memoryDir: string = resolveMemoryDir()) {
    this.memoryDir = memoryDir;
  }

  /**
   * 更新 LRU 缓存访问顺序
   * 将指定键移到 Map 末尾（最近使用位置）
   * @param id 记忆ID
   */
  private touchCache(id: string): void {
    const entry = this.memoryCache.get(id);
    if (entry) {
      this.memoryCache.delete(id);
      this.memoryCache.set(id, entry);
    }
  }

  /**
   * 将记忆写入缓存，如果超出大小则淘汰最久未使用的条目
   * @param id 记忆ID
   * @param memory 记忆对象
   */
  private setCache(id: string, memory: Memory): void {
    if (this.memoryCache.size >= this.MAX_CACHE_SIZE) {
      const oldestKey = this.memoryCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.memoryCache.delete(oldestKey);
      }
    }
    this.memoryCache.set(id, memory);
  }

  /**
   * 注册替代存储后端
   * @param name 后端名称
   * @param backend 后端实现
   */
  registerStoreBackend(name: string, backend: MemoryStoreBackend): void {
    this.backends.set(name, backend);
  }

  /**
   * 获取已注册的后端列表
   * @returns 后端名称列表
   */
  getRegisteredBackends(): string[] {
    return Array.from(this.backends.keys());
  }

  /**
   * 保存向量索引
   */
  async saveVectorIndex(
    vectors: Record<
      string,
      { vector: number[]; model: string; timestamp: string }
    >
  ): Promise<void> {
    await this.ensureMemoryDirExists();
    await fs.writeFile(
      this.getVectorIndexPath(),
      JSON.stringify(vectors, null, 2),
      'utf8'
    );
  }

  /**
   * 加载向量索引
   */
  async loadVectorIndex(): Promise<
    Record<string, { vector: number[]; model: string; timestamp: string }>
  > {
    await this.ensureMemoryDirExists();
    try {
      await fs.access(this.getVectorIndexPath());
      const content = await fs.readFile(this.getVectorIndexPath(), 'utf8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  /**
   * 保存单个记忆的向量
   */
  async saveMemoryVector(
    memoryId: string,
    vector: number[],
    model: string
  ): Promise<void> {
    const vectors = await this.loadVectorIndex();
    vectors[memoryId] = {
      vector,
      model,
      timestamp: new Date().toISOString(),
    };
    await this.saveVectorIndex(vectors);
  }

  /**
   * 获取单个记忆的向量
   */
  async getMemoryVector(
    memoryId: string
  ): Promise<{ vector: number[]; model: string; timestamp: string } | null> {
    const vectors = await this.loadVectorIndex();
    return vectors[memoryId] || null;
  }

  /**
   * 删除单个记忆的向量
   */
  async deleteMemoryVector(memoryId: string): Promise<void> {
    const vectors = await this.loadVectorIndex();
    delete vectors[memoryId];
    await this.saveVectorIndex(vectors);
  }

  /**
   * 确保记忆目录存在
   */
  async ensureMemoryDirExists(): Promise<void> {
    await fsExtra.ensureDir(this.memoryDir);
  }

  /**
   * 获取记忆文件路径
   * @param id 记忆ID
   * @returns 记忆文件路径
   */
  private getMemoryFilePath(id: string): string {
    validateMemoryId(id);
    return join(this.memoryDir, `${id}.md`);
  }

  /**
   * 获取记忆索引文件路径
   * @returns 记忆索引文件路径
   */
  private getMemoryIndexPath(): string {
    return join(this.memoryDir, 'MEMORY.md');
  }

  /**
   * 保存记忆
   * 写入磁盘后同步更新 LRU 缓存
   * @param memory 记忆对象
   */
  async saveMemory(memory: Memory): Promise<void> {
    await this.ensureMemoryDirExists();

    // 构建frontmatter元数据
    const frontmatter: Record<string, unknown> = {};

    // 只添加非undefined的值
    if (memory.id !== undefined) {
      frontmatter.id = memory.id;
    }

    if (memory.metadata.name !== undefined) {
      frontmatter.name = memory.metadata.name;
    }

    if (memory.metadata.description !== undefined) {
      frontmatter.description = memory.metadata.description;
    }

    if (memory.metadata.type !== undefined) {
      frontmatter.type = memory.metadata.type;
    }

    if (memory.metadata.createdAt) {
      frontmatter.createdAt = memory.metadata.createdAt.toISOString();
    } else {
      frontmatter.createdAt = new Date().toISOString();
    }

    if (memory.metadata.updatedAt) {
      frontmatter.updatedAt = memory.metadata.updatedAt.toISOString();
    } else {
      frontmatter.updatedAt = new Date().toISOString();
    }

    if (memory.metadata.tags && memory.metadata.tags.length > 0) {
      frontmatter.tags = memory.metadata.tags;
    }

    if (memory.metadata.priority !== undefined) {
      frontmatter.priority = memory.metadata.priority;
    }

    if (memory.metadata.expiresAt) {
      frontmatter.expiresAt = memory.metadata.expiresAt.toISOString();
    }

    if (memory.metadata.author) {
      frontmatter.author = memory.metadata.author;
    }

    if (memory.metadata.source) {
      frontmatter.source = memory.metadata.source;
    }

    // 验证Markdown内容
    const validatedContent = this.validateMarkdownContent(memory.content);

    // 创建Markdown内容
    const content = matter.stringify(validatedContent, frontmatter);

    // 写入文件
    const filePath = this.getMemoryFilePath(memory.id);
    await fs.writeFile(filePath, content);

    // 同步更新LRU缓存
    this.setCache(memory.id, memory);
  }

  /**
   * 验证Markdown内容
   * @param content Markdown内容
   * @returns 验证后的内容
   */
  private validateMarkdownContent(content: string): string {
    // 基本验证，确保内容不为空
    if (!content || content.trim() === '') {
      return 'No content provided';
    }

    // 可以添加更多验证逻辑，比如检查Markdown格式是否正确
    return content;
  }

  /**
   * 读取记忆
   * 优先从 LRU 缓存获取，缓存未命中时从磁盘读取并写入缓存
   * @param id 记忆ID
   * @returns 记忆对象或null
   */
  async readMemory(id: string): Promise<Memory | null> {
    // 优先从缓存读取
    const cached = this.memoryCache.get(id);
    if (cached) {
      this.touchCache(id);
      return cached;
    }

    const filePath = this.getMemoryFilePath(id);

    try {
      // 检查文件是否存在
      await fs.access(filePath, constants.F_OK);

      // 读取文件内容
      const content = await fs.readFile(filePath, 'utf-8');

      // 解析frontmatter
      const { data, content: memoryContent } = matter(content);

      // 构建记忆对象
      const memory: Memory = {
        id: data.id,
        content: memoryContent.trim(),
        metadata: createMemoryMetadata({
          name: data.name,
          description: data.description,
          type: data.type,
          createdAt: new Date(data.createdAt),
          updatedAt: new Date(data.updatedAt),
          tags: data.tags,
          priority: data.priority,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
          author: data.author,
          source: data.source,
        }),
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
      };

      // 写入缓存
      this.setCache(id, memory);

      return memory;
    } catch (error) {
      return null;
    }
  }

  /**
   * 删除记忆
   * 删除磁盘文件后同步清理 LRU 缓存
   * @param id 记忆ID
   */
  async deleteMemory(id: string): Promise<void> {
    const filePath = this.getMemoryFilePath(id);

    try {
      // 检查文件是否存在
      await fs.access(filePath, constants.F_OK);

      // 删除文件
      await fs.unlink(filePath);
    } catch (error) {
      // 文件不存在，忽略错误
    }

    // 从缓存中移除
    this.memoryCache.delete(id);

    // 删除向量索引
    await this.deleteMemoryVector(id);
  }

  /**
   * 列出所有记忆
   * @returns 记忆ID列表
   */
  async listMemories(): Promise<string[]> {
    await this.ensureMemoryDirExists();

    try {
      // 读取目录内容
      const files = await fs.readdir(this.memoryDir);

      // 过滤出.md文件并排除MEMORY.md
      const memoryFiles = files.filter(
        (file) => file.endsWith('.md') && file !== 'MEMORY.md'
      );

      // 提取记忆ID
      const memoryIds = memoryFiles.map((file) => {
        return file.replace('.md', '');
      });

      return memoryIds;
    } catch (error) {
      return [];
    }
  }

  /**
   * 读取记忆索引
   * @returns 记忆索引内容
   */
  async readMemoryIndex(): Promise<string> {
    const indexPath = this.getMemoryIndexPath();

    try {
      // 检查文件是否存在
      await fs.access(indexPath, constants.F_OK);

      // 读取文件内容
      return await fs.readFile(indexPath, 'utf-8');
    } catch (error) {
      // 文件不存在，返回空字符串
      return '';
    }
  }

  /**
   * 更新记忆索引
   */
  async updateMemoryIndex(): Promise<void> {
    await this.ensureMemoryDirExists();

    // 获取所有记忆
    const memoryIds = await this.listMemories();

    // 读取所有记忆详情
    const memories: Memory[] = [];
    for (const id of memoryIds) {
      const memory = await this.readMemory(id);
      if (memory) {
        memories.push(memory);
      }
    }

    // 按更新时间排序（最新的在前）
    memories.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    // 构建索引内容
    let indexContent = '# Memory Index\n\n';
    indexContent += 'This file contains an index of all memories.\n\n';
    indexContent += '## Statistics\n\n';
    indexContent += `- Total memories: ${memories.length}\n`;

    // 按类型统计
    const typeStats: Record<string, number> = {};
    for (const memory of memories) {
      const type = memory.metadata.type || 'unknown';
      typeStats[type] = (typeStats[type] || 0) + 1;
    }

    indexContent += '- Memories by type:\n';
    for (const [type, count] of Object.entries(typeStats)) {
      indexContent += `  - ${type}: ${count}\n`;
    }

    indexContent += '\n## Memories\n\n';

    // 为每个记忆添加索引项
    for (const memory of memories) {
      indexContent += `### ${memory.metadata.name}\n`;
      indexContent += `- **ID**: ${memory.id}\n`;
      indexContent += `- **Type**: ${memory.metadata.type || 'unknown'}\n`;
      indexContent += `- **Created**: ${memory.createdAt.toISOString()}\n`;
      indexContent += `- **Updated**: ${memory.updatedAt.toISOString()}\n`;
      if (memory.metadata.description) {
        indexContent += `- **Description**: ${memory.metadata.description}\n`;
      }
      if (memory.metadata.tags && memory.metadata.tags.length > 0) {
        indexContent += `- **Tags**: ${memory.metadata.tags.join(', ')}\n`;
      }
      if (memory.metadata.priority) {
        indexContent += `- **Priority**: ${memory.metadata.priority}\n`;
      }
      indexContent += `- **File**: [${memory.id}.md](${memory.id}.md)\n`;
      indexContent += '\n';
    }

    // 写入索引文件
    const indexPath = this.getMemoryIndexPath();
    await fs.writeFile(indexPath, indexContent);
  }

  /**
   * 导出记忆为Markdown文件
   * @param id 记忆ID
   * @param exportDir 导出目录
   * @returns 导出文件路径
   */
  async exportMemoryAsMarkdown(
    id: string,
    exportDir: string = './exports'
  ): Promise<string> {
    validateMemoryId(id);
    validateMemoryPath(exportDir, 'exportDir');

    const memory = await this.readMemory(id);
    if (!memory) {
      throw new AppError(
        `Memory with id ${id} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 确保导出目录存在
    await fsExtra.ensureDir(exportDir);

    // 生成导出文件路径
    const exportPath = join(exportDir, `${memory.id}.md`);

    // 构建frontmatter元数据
    const frontmatter: Record<string, unknown> = {
      id: memory.id,
      name: memory.metadata.name,
      description: memory.metadata.description,
      type: memory.metadata.type,
      createdAt: memory.createdAt.toISOString(),
      updatedAt: memory.updatedAt.toISOString(),
      tags: memory.metadata.tags,
      priority: memory.metadata.priority,
      expiresAt: memory.metadata.expiresAt?.toISOString(),
      author: memory.metadata.author,
      source: memory.metadata.source,
    };

    // 创建Markdown内容
    const content = matter.stringify(memory.content, frontmatter);

    // 写入导出文件
    await fs.writeFile(exportPath, content);

    return exportPath;
  }

  /**
   * 导入Markdown文件为记忆
   * @param filePath Markdown文件路径
   * @returns 创建的记忆ID
   */
  async importMemoryFromMarkdown(filePath: string): Promise<string> {
    validateMemoryPath(filePath, 'filePath');

    try {
      // 读取文件内容
      const content = await fs.readFile(filePath, 'utf-8');

      // 解析frontmatter
      const { data, content: memoryContent } = matter(content);

      // 生成新的记忆ID（如果文件中没有）
      const id =
        data.id ||
        `memory_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // 构建记忆对象
      const memory: Memory = {
        id,
        content: memoryContent.trim(),
        metadata: createMemoryMetadata({
          name: data.name || 'Imported Memory',
          description: data.description,
          type: data.type || 'reference',
          createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
          updatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date(),
          tags: data.tags,
          priority: data.priority,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
          author: data.author,
          source: data.source,
        }),
        createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
        updatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date(),
      };

      // 保存记忆
      await this.saveMemory(memory);

      return id;
    } catch (error) {
      throw new AppError(
        `Failed to import memory from Markdown: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  /**
   * 获取记忆的Markdown预览
   * @param id 记忆ID
   * @returns Markdown预览内容
   */
  async getMemoryMarkdownPreview(id: string): Promise<string> {
    const memory = await this.readMemory(id);
    if (!memory) {
      throw new AppError(
        `Memory with id ${id} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 构建预览内容
    let preview = `# ${memory.metadata.name}\n\n`;
    preview += `**Type**: ${memory.metadata.type || 'unknown'}\n`;
    preview += `**Updated**: ${memory.updatedAt.toISOString()}\n\n`;

    if (memory.metadata.description) {
      preview += `## Description\n${memory.metadata.description}\n\n`;
    }

    preview += `## Content\n${memory.content}\n`;

    return preview;
  }
}
