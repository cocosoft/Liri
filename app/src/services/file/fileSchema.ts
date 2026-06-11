/**
 * MIT License
 * Copyright (c) 2026 190615273@qq.com
 *
 * 文件管理系统 — 数据库 Schema 定义
 *
 * 表名约定：
 *   - 主表：file_files（模块前缀 file_ + 表名 files）
 *   - FTS5 虚拟表：file_files_fts
 *   - 触发器：file_files_{after_insert|after_delete|after_update}
 *
 * 字段设计覆盖文件注册中心全部需求：
 *   - MD5 去重（idx_files_md5 索引）
 *   - 来源/分区筛选（idx_files_source / idx_files_store_zone）
 *   - 时间归档（idx_files_created_at）
 *   - 原始名/保存名双向映射（idx_files_original_name / idx_files_saved_name）
 *   - 保存路径唯一约束（idx_files_saved_path）
 *   - 压缩包关联查询（idx_files_archive_parent）
 *   - 全文搜索（FTS5）
 */

// ─── 表名常量 ─────────────────────────────

/** 主表名 */
export const FILES_TABLE = 'file_files';

/** FTS5 全文搜索虚拟表名 */
export const FILES_FTS_TABLE = 'file_files_fts';

// ─── 主表 DDL ─────────────────────────────

/**
 * 主表 CREATE TABLE 语句
 *
 * 注意：同步修改 FTS5 内容表字段列表（FTS5_COLUMNS）
 */
export const CREATE_FILES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${FILES_TABLE} (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id           TEXT NOT NULL UNIQUE,                -- UUID 短格式（8 位）
    original_name     TEXT NOT NULL,                        -- 原始文件名（UTF-8）
    saved_name        TEXT NOT NULL,                        -- 保存文件名（统一命名）
    saved_path        TEXT NOT NULL,                        -- 保存完整路径
    md5               TEXT NOT NULL,                        -- 文件 MD5（32 位 hex）
    size              INTEGER NOT NULL DEFAULT 0,           -- 文件大小（字节）
    mime_type         TEXT DEFAULT '',                      -- MIME 类型
    source            TEXT NOT NULL DEFAULT 'unknown',      -- 来源枚举（FileSource）
    source_id         TEXT DEFAULT '',                      -- 来源 ID（会话ID/消息ID等）
    store_zone        TEXT NOT NULL DEFAULT 'inbound',      -- 存储分区：inbound | media | artifact | notebook
    media_type        TEXT DEFAULT '',                      -- 媒体子类型（store_zone=media 时有效）
    category          TEXT DEFAULT 'other',                 -- 文件分类
    description       TEXT DEFAULT '',                      -- 来源描述
    is_archive        INTEGER NOT NULL DEFAULT 0,           -- 是否为压缩包/归档文件
    archive_parent_id TEXT DEFAULT '',                      -- 解压文件的父压缩包 file_id
    ref_count         INTEGER NOT NULL DEFAULT 1,           -- 引用计数（同 MD5 重复时递增）
    is_deleted        INTEGER NOT NULL DEFAULT 0,           -- 软删除标记
    created_at        INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at        INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  )
`;

// ─── 索引 DDL ─────────────────────────────

export const CREATE_FILES_INDEXES_SQL: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_files_md5 ON ${FILES_TABLE}(md5)`,
  `CREATE INDEX IF NOT EXISTS idx_files_source ON ${FILES_TABLE}(source)`,
  `CREATE INDEX IF NOT EXISTS idx_files_store_zone ON ${FILES_TABLE}(store_zone)`,
  `CREATE INDEX IF NOT EXISTS idx_files_created_at ON ${FILES_TABLE}(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_files_original_name ON ${FILES_TABLE}(original_name)`,
  `CREATE INDEX IF NOT EXISTS idx_files_saved_name ON ${FILES_TABLE}(saved_name)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_files_saved_path ON ${FILES_TABLE}(saved_path)`,
  `CREATE INDEX IF NOT EXISTS idx_files_archive_parent ON ${FILES_TABLE}(archive_parent_id)`,
];

// ─── FTS5 全文搜索 ─────────────────────────

/**
 * FTS5 搜索字段列表
 * 只对文本类字段建立全文索引（file_id 和路径类字段不搜索）
 */
export const FTS5_COLUMNS = ['original_name', 'description', 'source', 'mime_type'] as const;

/**
 * 创建 FTS5 虚拟表
 * content= 指向主表，实现外部内容存储（不复制数据）
 * content_rowid= 映射主表 id 字段
 */
export const CREATE_FILES_FTS_TABLE_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS ${FILES_FTS_TABLE} USING fts5(
    ${FTS5_COLUMNS.join(', ')},
    content='${FILES_TABLE}',
    content_rowid='id',
    tokenize='unicode61'
  )
`;

// ─── FTS5 同步触发器 ───────────────────────

/**
 * INSERT 触发器：新行写入后自动同步到 FTS5
 */
export const CREATE_FTS_AFTER_INSERT_TRIGGER_SQL = `
  CREATE TRIGGER IF NOT EXISTS ${FILES_TABLE}_after_insert
  AFTER INSERT ON ${FILES_TABLE}
  BEGIN
    INSERT INTO ${FILES_FTS_TABLE}(rowid, ${FTS5_COLUMNS.join(', ')})
    VALUES (new.id, new.original_name, new.description, new.source, new.mime_type);
  END
`;

/**
 * DELETE 触发器：行删除后同步删除 FTS5 索引
 */
export const CREATE_FTS_AFTER_DELETE_TRIGGER_SQL = `
  CREATE TRIGGER IF NOT EXISTS ${FILES_TABLE}_after_delete
  AFTER DELETE ON ${FILES_TABLE}
  BEGIN
    INSERT INTO ${FILES_FTS_TABLE}(${FILES_FTS_TABLE}, rowid, ${FTS5_COLUMNS.join(', ')})
    VALUES ('delete', old.id, old.original_name, old.description, old.source, old.mime_type);
  END
`;

/**
 * UPDATE 触发器：行更新后同步更新 FTS5 索引
 */
export const CREATE_FTS_AFTER_UPDATE_TRIGGER_SQL = `
  CREATE TRIGGER IF NOT EXISTS ${FILES_TABLE}_after_update
  AFTER UPDATE ON ${FILES_TABLE}
  BEGIN
    INSERT INTO ${FILES_FTS_TABLE}(${FILES_FTS_TABLE}, rowid, ${FTS5_COLUMNS.join(', ')})
    VALUES ('delete', old.id, old.original_name, old.description, old.source, old.mime_type);
    INSERT INTO ${FILES_FTS_TABLE}(rowid, ${FTS5_COLUMNS.join(', ')})
    VALUES (new.id, new.original_name, new.description, new.source, new.mime_type);
  END
`;

// ─── 统一创建函数 ───────────────────────────

/**
 * 获取完整建表 SQL 列表（按顺序执行）
 * 先建主表 → 再建索引 → 再建 FTS5 → 再建触发器
 */
export function getCreateTableSqlList(): string[] {
  return [
    CREATE_FILES_TABLE_SQL,
    ...CREATE_FILES_INDEXES_SQL,
    CREATE_FILES_FTS_TABLE_SQL,
    CREATE_FTS_AFTER_INSERT_TRIGGER_SQL,
    CREATE_FTS_AFTER_DELETE_TRIGGER_SQL,
    CREATE_FTS_AFTER_UPDATE_TRIGGER_SQL,
  ];
}
