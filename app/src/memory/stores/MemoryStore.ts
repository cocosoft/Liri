import { promises as fs, constants } from 'fs';
import fsExtra from 'fs-extra';
import { join, dirname, basename, resolve, normalize } from 'path';
import matter from 'gray-matter';
import { glob } from 'glob';
import type { Memory } from '../types/Memory';
import { createMemoryMetadata } from '../types/MemoryMetadata';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import { resolveMemoryDir, resolveDbPath } from '@modules/core';
import { Database } from '@modules/core/external/sqlite3';
import { registerShutdownHandler } from '@modules/utils/gracefulShutdown';
import { getMemoryDriftDetector } from '../MemoryDriftDetector';

const storeLogger = getLogger('memory:stores');

/** memory_vectors 表名 */
const MEMORY_VECTORS_TABLE = 'memory_vectors';

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

  // 按来源 ID 查找记忆（用于去重查询和级联清理）
  findBySourceId(sourceId: string): Promise<Memory[]>;
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
   * 批量写入节流（任务 6）
   * 1 秒窗口内多次 saveMemory 合并为一个 flush 操作
   */
  private pendingBatch: Map<string, Memory> = new Map();
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 文件路径缓存（任务 4：按 session 分目录）
   * 映射 memoryId → 完整文件路径，避免每次 read/delete 都搜索子目录
   */
  private filePathCache: Map<string, string> = new Map();

  /**
   * 原子写入文件
   * 先写入 .tmp 临时文件，再 rename 为最终路径，避免写入中断导致文件半残
   * 每次写入前清理同名的旧 .tmp 文件
   */
  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const tmpPath = filePath + '.tmp';

    // 清理前次残留的 .tmp 文件
    try {
      await fs.unlink(tmpPath);
    } catch (err) {
      // 不存在则忽略
    }

    // 写入临时文件
    await fs.writeFile(tmpPath, content, 'utf8');
    // 原子替换
    await fs.rename(tmpPath, filePath);
  }

  /**
   * 批量刷新：将 pendingBatch 中的记忆全部写入磁盘
   */
  async flushBatch(): Promise<void> {
    if (this.pendingBatch.size === 0) return;

    const batch = new Map(this.pendingBatch);
    this.pendingBatch.clear();

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    for (const [id, memory] of batch) {
      try {
        // 构建 frontmatter 元数据
        const frontmatter: Record<string, unknown> = {};

        if (memory.id !== undefined) frontmatter.id = memory.id;
        if (memory.metadata.name !== undefined)
          frontmatter.name = memory.metadata.name;
        if (memory.metadata.description !== undefined)
          frontmatter.description = memory.metadata.description;
        if (memory.metadata.type !== undefined)
          frontmatter.type = memory.metadata.type;
        frontmatter.createdAt =
          memory.metadata.createdAt?.toISOString() ?? new Date().toISOString();
        frontmatter.updatedAt =
          memory.metadata.updatedAt?.toISOString() ?? new Date().toISOString();
        if (memory.metadata.tags && memory.metadata.tags.length > 0)
          frontmatter.tags = memory.metadata.tags;
        if (memory.metadata.priority !== undefined)
          frontmatter.priority = memory.metadata.priority;
        if (memory.metadata.importance !== undefined)
          frontmatter.importance = memory.metadata.importance;
        if (memory.metadata.expiresAt)
          frontmatter.expiresAt = memory.metadata.expiresAt.toISOString();
        if (memory.metadata.author) frontmatter.author = memory.metadata.author;
        if (memory.metadata.source) frontmatter.source = memory.metadata.source;
        if (memory.metadata.sessionId)
          frontmatter.sessionId = memory.metadata.sessionId;

        // 新字段: 梦境追踪
        if (memory.metadata.schemaVersion !== undefined)
          frontmatter.schemaVersion = memory.metadata.schemaVersion;
        if (memory.metadata.dreamProcessedAt !== undefined)
          frontmatter.dreamProcessedAt = memory.metadata.dreamProcessedAt;
        if (memory.metadata.dreamSource)
          frontmatter.dreamSource = memory.metadata.dreamSource;
        if (memory.metadata.dreamRefined !== undefined)
          frontmatter.dreamRefined = memory.metadata.dreamRefined;
        if (memory.metadata.deprecatedBy)
          frontmatter.deprecatedBy = memory.metadata.deprecatedBy;
        if (memory.metadata.deprecatedAt !== undefined)
          frontmatter.deprecatedAt = memory.metadata.deprecatedAt;
        if (memory.metadata.supersedes)
          frontmatter.supersedes = memory.metadata.supersedes;

        const validatedContent = this.validateMarkdownContent(memory.content);
        // 修复（预存错误 #57-1）：gray-matter stringify 对字符串首参会先 parse（index.js L161），
        // content 首行 `---page-break---` 会被误判为 frontmatter language → engine 未注册抛错。
        // 传对象 `{ content }` 绕过 parse 副作用，正文原样保留。
        const content = matter.stringify(
          { content: validatedContent },
          frontmatter
        );
        // 任务 4：按 session 分目录，使用 sessionId 确定目标路径
        const filePath = this.getMemoryFilePath(id, memory.metadata.sessionId);
        await this.atomicWrite(filePath, content);

        // P2-7: 写入后重新拍快照，保护文件不被外部意外修改
        try {
          getMemoryDriftDetector().snapshot(filePath);
        } catch (err) {
          await handleError(err, {
            module: 'memory:stores',
            action: 'driftSnapshot',
          });
        }
      } catch (error) {
        await handleError(error, {
          module: 'memory:stores',
          action: 'flushBatch',
        });
        storeLogger.error(`批量写入失败`, { id, error });
      }
    }
  }

  private scheduleFlush(): void {
    if (this.batchTimer) return;
    this.batchTimer = setTimeout(() => {
      this.flushBatch().catch((error) => {
        handleError(error, {
          module: 'memory:stores',
          action: 'scheduleFlush',
        }).catch(() => {});
        storeLogger.error('定时批量刷新失败', { error });
      });
    }, 1000);
  }

  /**
   * 构造函数
   * @param memoryDir 记忆目录路径
   * @param dbPath 数据库路径，默认使用 resolveDbPath()
   */
  constructor(
    memoryDir: string = resolveMemoryDir(),
    private dbPath: string = resolveDbPath()
  ) {
    this.memoryDir = memoryDir;

    // KB-MEM-FLUSH-EXIT（2026-08-29）：saveMemory 仅入 pendingBatch + 1s 延时写，
    // 进程正常退出（SIGINT/SIGTERM/uncaughtException）时若 1s 窗口未到，
    // 内存队列中的记忆会静默丢失。注册退出钩子兜底 flush。
    // 多实例时各注册一个 handler，flushBatch 空队列时直接返回，无副作用。
    registerShutdownHandler(() => this.flushBatch());
  }

  /**
   * 惰性初始化 SQLite 数据库和 memory_vectors 表
   */
  private async ensureVectorTable(): Promise<Database> {
    const db = new Database(this.dbPath);
    await new Promise<void>((resolve, reject) => {
      db.run(
        `CREATE TABLE IF NOT EXISTS ${MEMORY_VECTORS_TABLE} (
          memory_id TEXT PRIMARY KEY,
          vector TEXT NOT NULL,
          model TEXT NOT NULL,
          model_version TEXT DEFAULT '' NOT NULL,
          timestamp TEXT NOT NULL
        )`,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    return db;
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
   * 保存向量索引（全量覆盖）
   * 将整个向量索引写入 SQLite memory_vectors 表
   */
  async saveVectorIndex(
    vectors: Record<
      string,
      {
        vector: number[];
        model: string;
        timestamp: string;
        model_version?: string;
      }
    >
  ): Promise<void> {
    const db = await this.ensureVectorTable();
    await new Promise<void>((resolve, reject) => {
      db.run('BEGIN TRANSACTION');
      for (const [memoryId, entry] of Object.entries(vectors)) {
        db.run(
          `INSERT OR REPLACE INTO ${MEMORY_VECTORS_TABLE} (memory_id, vector, model, model_version, timestamp)
           VALUES (?, ?, ?, ?, ?)`,
          memoryId,
          JSON.stringify(entry.vector),
          entry.model,
          entry.model_version ?? '',
          entry.timestamp
        );
      }
      db.run('COMMIT', (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
    storeLogger.info('向量索引已保存到 SQLite', {
      count: Object.keys(vectors).length,
    });
  }

  /**
   * 加载向量索引
   * 从 SQLite memory_vectors 表读取所有向量
   */
  async loadVectorIndex(): Promise<
    Record<
      string,
      {
        vector: number[];
        model: string;
        timestamp: string;
        model_version?: string;
      }
    >
  > {
    const db = await this.ensureVectorTable();
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      db.all(
        `SELECT memory_id, vector, model, model_version, timestamp FROM ${MEMORY_VECTORS_TABLE}`,
        (err: Error | null, rows?: unknown[]) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    const result: Record<
      string,
      {
        vector: number[];
        model: string;
        timestamp: string;
        model_version?: string;
      }
    > = {};
    for (const rawRow of rows) {
      const row = rawRow as Record<string, unknown>;
      result[row.memory_id as string] = {
        vector: JSON.parse(row.vector as string),
        model: row.model as string,
        model_version: (row.model_version as string) || undefined,
        timestamp: row.timestamp as string,
      };
    }
    return result;
  }

  /**
   * 保存单个记忆的向量
   */
  async saveMemoryVector(
    memoryId: string,
    vector: number[],
    model: string,
    modelVersion?: string
  ): Promise<void> {
    const db = await this.ensureVectorTable();
    await new Promise<void>((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO ${MEMORY_VECTORS_TABLE} (memory_id, vector, model, model_version, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
        memoryId,
        JSON.stringify(vector),
        model,
        modelVersion ?? '',
        new Date().toISOString(),
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 获取单个记忆的向量
   */
  async getMemoryVector(memoryId: string): Promise<{
    vector: number[];
    model: string;
    timestamp: string;
    model_version?: string;
  } | null> {
    const db = await this.ensureVectorTable();
    const row = await new Promise<unknown>((resolve, reject) => {
      db.get(
        `SELECT vector, model, model_version, timestamp FROM ${MEMORY_VECTORS_TABLE} WHERE memory_id = ?`,
        memoryId,
        (err: Error | null, row?: unknown) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
    if (!row) return null;
    const r = row as Record<string, unknown>;
    return {
      vector: JSON.parse(r.vector as string),
      model: r.model as string,
      model_version: (r.model_version as string) || undefined,
      timestamp: r.timestamp as string,
    };
  }

  /**
   * 删除单个记忆的向量
   */
  async deleteMemoryVector(memoryId: string): Promise<void> {
    const db = await this.ensureVectorTable();
    await new Promise<void>((resolve, reject) => {
      db.run(
        `DELETE FROM ${MEMORY_VECTORS_TABLE} WHERE memory_id = ?`,
        memoryId,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 确保记忆目录存在
   */
  async ensureMemoryDirExists(): Promise<void> {
    await fsExtra.ensureDir(this.memoryDir);
    // 任务 4：按 session 分目录，创建 global/ 和 sessions/ 子目录
    await fsExtra.ensureDir(join(this.memoryDir, 'global'));
    await fsExtra.ensureDir(join(this.memoryDir, 'sessions'));
    // 迁移旧扁平文件（仅首次执行）
    await this.migrateFlatFiles();
  }

  /**
   * 获取记忆文件路径（任务 4：按 session 分目录）
   * @param id 记忆ID
   * @param sessionId 会话ID（可选），有值时存入 sessions/{sessionId}/，无值时存入 global/
   */
  private getMemoryFilePath(id: string, sessionId?: string): string {
    validateMemoryId(id);
    if (sessionId) {
      return join(this.memoryDir, 'sessions', sessionId, `${id}.md`);
    }
    return join(this.memoryDir, 'global', `${id}.md`);
  }

  /**
   * 查找记忆文件路径（任务4：按session分目录）
   * 按 global/ -> sessions/ 子目录顺序搜索，找到后写入缓存加速
   */
  private async findMemoryPath(id: string): Promise<string | null> {
    // 优先查缓存
    const cached = this.filePathCache.get(id);
    if (cached) {
      try {
        await fs.access(cached, constants.F_OK);
        return cached;
      } catch (err) {
        this.filePathCache.delete(id);
      }
    }

    // 尝试 global/ 目录
    const globalPath = join(this.memoryDir, 'global', `${id}.md`);
    try {
      await fs.access(globalPath, constants.F_OK);
      this.filePathCache.set(id, globalPath);
      return globalPath;
    } catch (err) {
      // 不存在则继续搜索
    }

    // 搜索 sessions/*/ 子目录
    const sessionsDir = join(this.memoryDir, 'sessions');
    try {
      const sessionDirs = await fs.readdir(sessionsDir);
      for (const dir of sessionDirs) {
        const path = join(sessionsDir, dir, `${id}.md`);
        try {
          await fs.access(path, constants.F_OK);
          this.filePathCache.set(id, path);
          return path;
        } catch (err) {
          // 该子目录下不存在，继续搜索
        }
      }
    } catch (err) {
      // sessions/ 目录不存在
    }

    return null;
  }

  /**
   * 迁移旧扁平文件到 global/ 目录（任务 4：向后兼容）
   * 检测 memoryDir 根目录下的 .md 文件，移动到 global/ 子目录
   * 仅执行一次（迁移完成后根目录不再有 .md 文件）
   */
  private async migrateFlatFiles(): Promise<void> {
    const globalDir = join(this.memoryDir, 'global');
    await fsExtra.ensureDir(globalDir);

    try {
      const files = await fs.readdir(this.memoryDir);
      const mdFiles = files.filter(
        (f) => f.endsWith('.md') && f !== 'MEMORY.md'
      );

      if (mdFiles.length === 0) return;

      storeLogger.info(
        `迁移 ${mdFiles.length} 个旧扁平记忆文件到 global/ 目录`
      );

      for (const file of mdFiles) {
        const oldPath = join(this.memoryDir, file);
        const newPath = join(globalDir, file);
        try {
          await fs.rename(oldPath, newPath);
        } catch (error) {
          storeLogger.error('迁移记忆文件失败', { file, error });
        }
      }
    } catch (err) {
      // 目录为空或不存在，无需迁移
    }
  }

  /**
   * 获取记忆索引文件路径
   * @returns 记忆索引文件路径
   */
  private getMemoryIndexPath(): string {
    // 任务 4：索引文件存储在 global/ 子目录
    return join(this.memoryDir, 'global', 'MEMORY.md');
  }

  /**
   * 保存记忆
   * 写入磁盘后同步更新 LRU 缓存
   * @param memory 记忆对象
   */
  async saveMemory(memory: Memory): Promise<void> {
    await this.ensureMemoryDirExists();

    // 任务 4：按 session 分目录，确保目标子目录存在
    const sessionId = memory.metadata.sessionId;
    const targetDir = sessionId
      ? join(this.memoryDir, 'sessions', sessionId)
      : join(this.memoryDir, 'global');
    await fsExtra.ensureDir(targetDir);

    const filePath = this.getMemoryFilePath(memory.id, sessionId);
    this.filePathCache.set(memory.id, filePath);

    // 加入批量写入队列（1 秒窗口内合并写入）
    this.pendingBatch.set(memory.id, { ...memory });
    this.scheduleFlush();

    // 同步更新 LRU 缓存
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

    // 检查待刷新的批量写入队列
    const pending = this.pendingBatch.get(id);
    if (pending) {
      this.setCache(id, pending);
      return pending;
    }

    // 任务 4：按 session 分目录查找文件
    const filePath = await this.findMemoryPath(id);
    if (!filePath) return null;

    // P2-7: 读取前检查外部漂移，漂移则自动恢复原始内容
    try {
      getMemoryDriftDetector().check(filePath);
    } catch (err) {
      await handleError(err, { module: 'memory:stores', action: 'driftCheck' });
    }

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
          importance: data.importance,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
          author: data.author,
          source: data.source,
          sessionId: data.sessionId,
          schemaVersion: data.schemaVersion ?? 1,
          dreamProcessedAt: data.dreamProcessedAt ?? null,
          dreamSource: data.dreamSource,
          dreamRefined: data.dreamRefined ?? false,
          deprecatedBy: data.deprecatedBy,
          deprecatedAt: data.deprecatedAt,
          supersedes: data.supersedes,
        }),
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
      };

      // 写入缓存
      this.setCache(id, memory);

      return memory;
    } catch (error) {
      storeLogger.error(`记忆文件损坏或无法读取，已跳过`, {
        id,
        filePath,
        error,
      });
      return null;
    }
  }

  /**
   * 删除记忆
   * 删除磁盘文件后同步清理 LRU 缓存
   * @param id 记忆ID
   */
  async deleteMemory(id: string): Promise<void> {
    // 从批量写入队列中移除
    this.pendingBatch.delete(id);

    // 任务 4：按 session 分目录查找文件
    const filePath = await this.findMemoryPath(id);

    if (filePath) {
      try {
        // 检查文件是否存在
        await fs.access(filePath, constants.F_OK);

        // 删除文件
        await fs.unlink(filePath);
      } catch (error) {
        // 文件不存在，忽略错误
      }
    }

    // 清理缓存
    this.filePathCache.delete(id);
    this.memoryCache.delete(id);

    // 删除向量索引
    await this.deleteMemoryVector(id);
  }

  /**
   * 列出所有记忆（任务4：扫描 global/ 和 sessions/ 子目录）
   * @returns 记忆ID列表
   */
  async listMemories(): Promise<string[]> {
    await this.ensureMemoryDirExists();

    const memoryIds: string[] = [];

    try {
      // 扫描 global/ 目录
      const globalDir = join(this.memoryDir, 'global');
      const globalFiles = await fs.readdir(globalDir);
      for (const file of globalFiles) {
        if (file.endsWith('.md') && file !== 'MEMORY.md') {
          memoryIds.push(file.replace('.md', ''));
        }
      }
    } catch (err) {
      // global/ 目录为空，忽略
    }

    try {
      // 扫描 sessions/*/ 子目录
      const sessionsDir = join(this.memoryDir, 'sessions');
      const sessionDirs = await fs.readdir(sessionsDir);
      for (const dir of sessionDirs) {
        const dirPath = join(sessionsDir, dir);
        try {
          const stat = await fs.stat(dirPath);
          if (stat.isDirectory()) {
            const files = await fs.readdir(dirPath);
            for (const file of files) {
              if (file.endsWith('.md') && file !== 'MEMORY.md') {
                memoryIds.push(file.replace('.md', ''));
              }
            }
          }
        } catch (err) {
          // 子目录读取失败，跳过
        }
      }
    } catch (err) {
      // sessions/ 目录为空，忽略
    }

    return memoryIds;
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

    // 修复（预存错误 #57-1）：传对象绕过 gray-matter stringify 的字符串 parse 副作用
    const content = matter.stringify({ content: memory.content }, frontmatter);

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

  /**
   * 按来源 ID 查找记忆
   * 扫描所有记忆，检查 dreamSource.ids 或 sessionId 是否匹配
   * @param sourceId 来源 ID（sessionId 或知识文件路径）
   * @returns 匹配的记忆列表
   */
  async findBySourceId(sourceId: string): Promise<Memory[]> {
    const allIds = await this.listMemories();
    const results: Memory[] = [];

    for (const id of allIds) {
      const memory = await this.readMemory(id);
      if (!memory) continue;

      // 检查 dreamSource.ids
      if (memory.metadata.dreamSource?.ids?.includes(sourceId)) {
        results.push(memory);
        continue;
      }

      // 检查 sessionId
      if (memory.metadata.sessionId === sourceId) {
        results.push(memory);
        continue;
      }
    }

    return results;
  }
}
