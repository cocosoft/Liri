/**
 * MIT License
 * Copyright (c) 2026 190615273@qq.com
 *
 * 文件管理系统 — FileRegistry 文件注册中心
 *
 * 核心职责：
 *   1. 统一入站入口 — 所有文件必经注册中心
 *   2. MD5 去重 — 同内容文件仅保存一次
 *   3. 统一命名 — f_{timestamp}_{md5_prefix}_{original_name}
 *   4. 统一索引 — 所有入站文件记录到 file_files 表
 *   5. 分区存储 — 按 store_zone 分发到不同物理目录
 *
 * 使用方式：
 *   const registry = FileRegistry.getInstance();
 *   const result = await registry.registerFile({
 *     originalName: '报告.pdf',
 *     content: buffer,
 *     source: FileSource.UPLOAD,
 *   });
 */

import { Database } from 'sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { writeFile, unlink, stat, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { SimpleMutex } from '@modules/core/SimpleMutex';
import { resolveDbPath, resolveInboundDir, resolveMediaDir } from '@modules/core/paths';
import { getCreateTableSqlList, FILES_TABLE, FILES_FTS_TABLE } from './fileSchema';
import { generateSavedName, computeMd5 } from './fileNaming';
import { FileSource, type RegisterFileInput, type RegisterFileResult, type FileRecord, type FileListQuery, type FileListResult, type FileStats, type FileRow, rowToFileRecord } from './types';

const logger = new Logger({ level: LogLevel.INFO });

/** 大文件阈值：超过此大小的文件跳过 MD5 去重（100MB） */
const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024;

/**
 * FileRegistry 文件注册中心
 *
 * 单例模式，全局唯一实例。所有文件入站操作必须通过此中心。
 */
export class FileRegistry {
  private static instance: FileRegistry;

  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  /** 写操作互斥锁（防止并发 SQLite WAL 锁冲突） */
  private dbMutex = new SimpleMutex();

  /** 去重统计（内存计数器，用于 stats） */
  private dedupCount = 0;
  private dedupSize = 0;

  private constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  /**
   * 获取 FileRegistry 单例
   */
  static getInstance(dbPath?: string): FileRegistry {
    if (!FileRegistry.instance) {
      FileRegistry.instance = new FileRegistry(dbPath);
    }
    return FileRegistry.instance;
  }

  /**
   * 初始化数据库连接和表结构
   */
  async initDatabase(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    try {
      this.db = await new Promise<Database>((resolve, reject) => {
        const db = new Database(this.dbPath, (err) => {
          if (err) reject(err);
          else resolve(db);
        });
      });

      await this.createTables();
      this.initialized = true;
      logger.info('FileRegistry 初始化完成', { dbPath: this.dbPath });
    } catch (error) {
      logger.error('FileRegistry 初始化失败', error);
      throw new AppError(
        'FileRegistry 初始化失败',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'FILE_REGISTRY_INIT_FAILED',
        { cause: error }
      );
    }
  }

  /**
   * 创建数据库表
   */
  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const sqlList = getCreateTableSqlList();
    for (const sql of sqlList) {
      await this.runAsync(sql);
    }
    logger.info('file_files 表创建/验证完成');
  }

  // ─── 核心方法 ─────────────────────────────

  /**
   * 注册文件（核心入站方法）
   *
   * 流程：
   *   1. 计算 MD5
   *   2. 查重（MD5 已存在 → 递增 ref_count，返回 duplicate）
   *   3. 生成保存名和保存路径
   *   4. 写文件到磁盘
   *   5. 写 DB 记录
   *   6. 失败时回滚（删除已写文件）
   *
   * @param input - 注册请求
   * @returns 注册结果
   */
  async registerFile(input: RegisterFileInput): Promise<RegisterFileResult> {
    await this.initDatabase();
    if (!this.db) throw new Error('Database not initialized');

    const {
      originalName,
      content,
      source,
      sourceId = '',
      mimeType = '',
      description = '',
      storeZone = 'inbound',
      mediaType = '',
      isArchive = false,
      archiveParentId = '',
      skipDedup = false,
    } = input;

    // Step 1: 计算 MD5
    const contentBuffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
    const md5 = computeMd5(contentBuffer);
    const fileSize = contentBuffer.length;

    // Step 2: MD5 查重（大文件跳过）
    if (!skipDedup && fileSize < LARGE_FILE_THRESHOLD) {
      const existing = await this.findByMd5(md5);
      if (existing) {
        // 递增引用计数
        await this.dbMutex.run(async () => {
          await this.runAsync(
            `UPDATE ${FILES_TABLE} SET ref_count = ref_count + 1, updated_at = strftime('%s', 'now') WHERE file_id = ?`,
            [existing.fileId]
          );
        });
        this.dedupCount++;
        this.dedupSize += existing.size;

        logger.info('文件去重命中', { md5, fileId: existing.fileId, originalName });
        return {
          action: 'duplicate',
          fileId: existing.fileId,
          savedPath: existing.savedPath,
          savedName: existing.savedName,
          originalName: existing.originalName,
          md5,
          existingRecord: existing,
        };
      }
    }

    // Step 3: 生成保存名
    const savedName = generateSavedName(originalName, md5);

    // 确定保存路径
    const savedPath = this.resolveSavedPath(storeZone, source, mediaType, savedName);

    // Step 4: 写文件到磁盘（自动创建目录）
    try {
      await mkdir(dirname(savedPath), { recursive: true });
      await writeFile(savedPath, contentBuffer);
    } catch (err) {
      throw new AppError(
        `文件写入失败: ${savedPath}`,
        ErrorCategory.FILESYSTEM,
        ErrorSeverity.HIGH,
        'FILE_WRITE_FAILED',
        { cause: err }
      );
    }

    // Step 5: 写 DB 记录
    const fileId = uuidv4().slice(0, 8);
    try {
      await this.dbMutex.run(async () => {
        await this.runAsync(
          `INSERT INTO ${FILES_TABLE}
            (file_id, original_name, saved_name, saved_path, md5, size, mime_type,
             source, source_id, store_zone, media_type, description, is_archive, archive_parent_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            fileId, originalName, savedName, savedPath, md5, fileSize, mimeType,
            source, sourceId, storeZone, mediaType, description,
            isArchive ? 1 : 0, archiveParentId,
          ]
        );
      });

      logger.info('文件注册成功', { fileId, originalName, savedName, source, size: fileSize });
      return {
        action: 'created',
        fileId,
        savedPath,
        savedName,
        originalName,
        md5,
      };
    } catch (err) {
      // DB 写入失败 → 回滚已写入的文件
      await unlink(savedPath).catch(() => {});
      throw new AppError(
        '文件注册失败，已回滚',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'DB_ERROR',
        { cause: err }
      );
    }
  }

  /**
   * 解析文件保存路径
   *
   * 按 store_zone 分发到不同物理目录：
   *   - inbound:  ~/.pyapp/knowledge/raw/inbound/{source}/{YYYY}/{MM}/{DD}/
   *   - media:    ~/.pyapp/media/{mediaType}/
   *   - artifact: ~/.pyapp/data/artifacts/
   *   - notebook: ~/.pyapp/data/notebooks/
   */
  private resolveSavedPath(
    storeZone: string,
    source: string,
    mediaType: string,
    savedName: string
  ): string {
    let baseDir: string;

    switch (storeZone) {
      case 'media':
        baseDir = resolveMediaDir();
        if (mediaType) {
          baseDir = join(baseDir, mediaType);
        }
        break;

      case 'artifact':
        // artifacts 保留现有位置
        baseDir = join(resolveDbPath(), '..', 'artifacts');
        break;

      case 'notebook':
        // notebooks 保留现有位置
        baseDir = join(resolveDbPath(), '..', 'notebooks');
        break;

      case 'inbound':
      default:
        // inbound 按来源/时间分层
        baseDir = resolveInboundDir(source);
        break;
    }

    return join(baseDir, savedName);
  }

  // ─── 查询方法 ─────────────────────────────

  /**
   * 按 MD5 查找已有记录
   *
   * @param md5 - 文件 MD5 值（32 位 hex）
   * @returns 文件记录，不存在返回 null
   */
  async findByMd5(md5: string): Promise<FileRecord | null> {
    await this.initDatabase();
    if (!this.db) throw new Error('Database not initialized');

    return this.dbMutex.run(async () => {
      const row = await this.getAsync<FileRow>(
        `SELECT * FROM ${FILES_TABLE} WHERE md5 = ? AND is_deleted = 0 LIMIT 1`,
        [md5]
      );
      return row ? rowToFileRecord(row) : null;
    });
  }

  /**
   * 按文件 ID 查找
   *
   * @param fileId - 文件唯一标识
   * @returns 文件记录，不存在返回 null
   */
  async getFileDetail(fileId: string): Promise<FileRecord | null> {
    await this.initDatabase();
    if (!this.db) throw new Error('Database not initialized');

    return this.dbMutex.run(async () => {
      const row = await this.getAsync<FileRow>(
        `SELECT * FROM ${FILES_TABLE} WHERE file_id = ? AND is_deleted = 0`,
        [fileId]
      );
      return row ? rowToFileRecord(row) : null;
    });
  }

  /**
   * 查询文件列表（支持来源/分区/时间/模糊搜索 + 分页）
   *
   * @param query - 查询参数
   * @returns 文件列表 + 统计
   */
  async listFiles(query: FileListQuery = {}): Promise<FileListResult> {
    await this.initDatabase();
    if (!this.db) throw new Error('Database not initialized');

    const {
      source,
      storeZone,
      isArchive,
      startDate,
      endDate,
      search,
      offset = 0,
      limit = 20,
    } = query;

    const conditions: string[] = ['is_deleted = 0'];
    const params: unknown[] = [];

    if (source) {
      conditions.push('source = ?');
      params.push(source);
    }
    if (storeZone) {
      conditions.push('store_zone = ?');
      params.push(storeZone);
    }
    if (isArchive !== undefined) {
      conditions.push('is_archive = ?');
      params.push(isArchive ? 1 : 0);
    }
    if (startDate) {
      conditions.push('created_at >= ?');
      params.push(Math.floor(new Date(startDate).getTime() / 1000));
    }
    if (endDate) {
      conditions.push('created_at <= ?');
      params.push(Math.floor(new Date(endDate).getTime() / 1000));
    }
    if (search) {
      conditions.push('original_name LIKE ?');
      params.push(`%${search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    return this.dbMutex.run(async () => {
      // 查询总数
      const countRow = await this.getAsync<{ total: number }>(
        `SELECT COUNT(*) as total FROM ${FILES_TABLE} ${whereClause}`,
        params
      );
      const total = countRow?.total ?? 0;

      // 查询列表
      const rows = await this.allAsync<FileRow>(
        `SELECT * FROM ${FILES_TABLE} ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );

      const files = rows.map(rowToFileRecord);

      return {
        files,
        total,
        stats: await this.computeStats(conditions, params),
      };
    });
  }

  /**
   * FTS5 全文搜索
   *
   * 使用 SQLite FTS5 对 original_name / description / source / mime_type 进行全文搜索。
   *
   * @param ftsQuery - FTS5 搜索关键词
   * @param limit - 最大返回数量（默认 20）
   * @returns 匹配的文件记录列表
   */
  async searchFiles(ftsQuery: string, limit: number = 20): Promise<FileRecord[]> {
    await this.initDatabase();
    if (!this.db) throw new Error('Database not initialized');

    return this.dbMutex.run(async () => {
      const rows = await this.allAsync<FileRow>(
        `SELECT f.* FROM ${FILES_TABLE} f
         INNER JOIN ${FILES_FTS_TABLE} fts ON f.id = fts.rowid
         WHERE ${FILES_FTS_TABLE} MATCH ? AND f.is_deleted = 0
         ORDER BY f.created_at DESC
         LIMIT ?`,
        [ftsQuery, limit]
      );
      return rows.map(rowToFileRecord);
    });
  }

  // ─── 管理方法 ─────────────────────────────

  /**
   * 批量软删除文件
   *
   * @param fileIds - 要删除的文件 ID 列表
   */
  async softDelete(fileIds: string[]): Promise<void> {
    await this.initDatabase();
    if (!this.db) throw new Error('Database not initialized');

    await this.dbMutex.run(async () => {
      for (const fileId of fileIds) {
        await this.runAsync(
          `UPDATE ${FILES_TABLE} SET is_deleted = 1, updated_at = strftime('%s', 'now') WHERE file_id = ?`,
          [fileId]
        );
      }
      logger.info('批量软删除完成', { count: fileIds.length });
    });
  }

  /**
   * 获取文件统计概览
   */
  async getStats(): Promise<FileStats> {
    await this.initDatabase();
    if (!this.db) throw new Error('Database not initialized');

    return this.dbMutex.run(async () => {
      return this.computeStats(['is_deleted = 0'], []);
    });
  }

  /**
   * 计算统计信息
   */
  private async computeStats(
    baseConditions: string[],
    baseParams: unknown[]
  ): Promise<FileStats> {
    if (!this.db) {
      return {
        totalFiles: 0, totalSize: 0, todayCount: 0,
        dedupSaved: 0, dedupSavedSize: 0,
        archiveCount: 0, mediaCount: 0, mediaSize: 0,
      };
    }

    const todayStart = Math.floor(
      new Date(new Date().toISOString().slice(0, 10)).getTime() / 1000
    );

    // 总文件数和总大小
    const allRow = await this.getAsync<{ count: number; size: number }>(
      `SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as size FROM ${FILES_TABLE} WHERE is_deleted = 0`,
      []
    );

    // 今日入站
    const todayRow = await this.getAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${FILES_TABLE} WHERE is_deleted = 0 AND created_at >= ?`,
      [todayStart]
    );

    // 压缩包数量
    const archiveRow = await this.getAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${FILES_TABLE} WHERE is_deleted = 0 AND is_archive = 1`,
      []
    );

    // 媒体文件统计
    const mediaRow = await this.getAsync<{ count: number; size: number }>(
      `SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as size FROM ${FILES_TABLE} WHERE is_deleted = 0 AND store_zone = 'media'`,
      []
    );

    return {
      totalFiles: allRow?.count ?? 0,
      totalSize: allRow?.size ?? 0,
      todayCount: todayRow?.count ?? 0,
      dedupSaved: this.dedupCount,
      dedupSavedSize: this.dedupSize,
      archiveCount: archiveRow?.count ?? 0,
      mediaCount: mediaRow?.count ?? 0,
      mediaSize: mediaRow?.size ?? 0,
    };
  }

  // ─── 大文件异步注册 ─────────────────────────

  /**
   * 异步注册大文件（跳过 MD5 去重，直接从文件路径注册）
   *
   * 适用场景：
   *   - 文件 > 100MB（避免全量读取到内存计算 MD5）
   *   - 文件已在磁盘上，需要注册到索引
   *
   * @param input - 注册请求（不含 content，使用 filePath 替代）
   * @param filePath - 已存在于磁盘的文件路径
   * @returns 注册结果
   */
  async registerFileAsync(
    input: Omit<RegisterFileInput, 'content'>,
    filePath: string
  ): Promise<RegisterFileResult> {
    await this.initDatabase();
    if (!this.db) throw new Error('Database not initialized');

    const {
      originalName,
      source,
      sourceId = '',
      mimeType = '',
      description = '',
      storeZone = 'inbound',
      mediaType = '',
      isArchive = false,
      archiveParentId = '',
    } = input;

    // 获取文件大小
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat) {
      throw new AppError(
        `文件不存在: ${filePath}`,
        ErrorCategory.FILESYSTEM,
        ErrorSeverity.HIGH,
        'FILE_NOT_FOUND'
      );
    }

    const fileSize = fileStat.size;
    const md5 = ''; // 大文件不计算 MD5

    // 生成保存名（没有 MD5，用空字符串占位）
    const savedName = generateSavedName(originalName, md5 || '00000000');
    const savedPath = this.resolveSavedPath(storeZone, source, mediaType, savedName);

    const fileId = uuidv4().slice(0, 8);

    // 写 DB 记录（大文件模式，MD5 为空）
    try {
      await this.dbMutex.run(async () => {
        await this.runAsync(
          `INSERT INTO ${FILES_TABLE}
            (file_id, original_name, saved_name, saved_path, md5, size, mime_type,
             source, source_id, store_zone, media_type, description, is_archive, archive_parent_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            fileId, originalName, savedName, savedPath, md5, fileSize, mimeType,
            source, sourceId, storeZone, mediaType, description,
            isArchive ? 1 : 0, archiveParentId,
          ]
        );
      });

      logger.info('大文件注册成功', { fileId, originalName, source, size: fileSize });
      return {
        action: 'created',
        fileId,
        savedPath,
        savedName,
        originalName,
        md5,
      };
    } catch (err) {
      throw new AppError(
        '大文件注册失败',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'DB_ERROR',
        { cause: err }
      );
    }
  }

  // ─── 数据库辅助方法 ─────────────────────────

  /**
   * 执行 SQL 查询，返回多行结果（公共 API，供 GC 等外部服务使用）
   */
  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.allAsync<T>(sql, params);
  }

  /**
   * 执行 SQL（无返回值）
   */
  private runAsync(sql: string, params?: unknown[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.db!.run(sql, params || [], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * 查询单行
   */
  private getAsync<T>(sql: string, params?: unknown[]): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve, reject) => {
      this.db!.get(sql, params || [], (err, row) => {
        if (err) reject(err);
        else resolve(row as T | undefined);
      });
    });
  }

  /**
   * 查询多行
   */
  private allAsync<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return new Promise<T[]>((resolve, reject) => {
      this.db!.all(sql, params || [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows as T[]);
      });
    });
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (this.db) {
      await new Promise<void>((resolve, reject) => {
        this.db?.close((err) => {
          if (err) reject(err);
          else {
            this.db = null;
            this.initialized = false;
            resolve();
          }
        });
      });
    }
  }
}
