/**
 * MIT License
 * Copyright (c) 2026 190615273@qq.com
 *
 * 文件管理系统 — 类型定义
 */

/**
 * 入站来源枚举
 *
 * 对齐 IChannel.ts 的 ChannelId 命名规范：
 *   渠道类型前缀 'channel_' + 渠道标识
 */
export enum FileSource {
  // ─── 用户上传 ───
  UPLOAD = 'upload',

  // ─── 渠道入站 ───
  CHANNEL_TELEGRAM = 'channel_telegram',
  CHANNEL_FEISHU = 'channel_feishu',
  CHANNEL_DINGTALK = 'channel_dingtalk',
  CHANNEL_WECOM = 'channel_wecom',
  CHANNEL_WECHAT = 'channel_wechat',
  CHANNEL_QQ = 'channel_qq',
  CHANNEL_DISCORD = 'channel_discord',
  CHANNEL_SLACK = 'channel_slack',
  CHANNEL_LINE = 'channel_line',
  CHANNEL_IRC = 'channel_irc',
  CHANNEL_NOSTR = 'channel_nostr',
  CHANNEL_EMAIL = 'channel_email',
  CHANNEL_SMS = 'channel_sms',
  CHANNEL_WEBHOOK = 'channel_webhook',
  CHANNEL_GOOGLECHAT = 'channel_googlechat',
  CHANNEL_MSTEAMS = 'channel_msteams',
  CHANNEL_ZALO = 'channel_zalo',
  CHANNEL_YUANBAO = 'channel_yuanbao',
  CHANNEL_WHATSAPP = 'channel_whatsapp',
  CHANNEL_SIGNAL = 'channel_signal',
  CHANNEL_MATRIX = 'channel_matrix',
  CHANNEL_FACEBOOK = 'channel_facebook',
  CHANNEL_TWITTER = 'channel_twitter',
  CHANNEL_CLAUDE = 'channel_claude',
  CHANNEL_MATTERMOST = 'channel_mattermost',
  CHANNEL_BLUEBUBBLES = 'channel_bluebubbles',

  // ─── AI 工具 ───
  TOOL_WRITE = 'tool_write',
  TOOL_DOWNLOAD = 'tool_download',
  TOOL_GENERATE = 'tool_generate',
  AUTO_INGEST = 'auto_ingest',

  // ─── 特殊文件类型 ───
  ARTIFACT = 'artifact',
  NOTEBOOK = 'notebook',
  ARCHIVE_EXTRACTED = 'archive_extracted',
}

/** 存储分区 */
export type StoreZone = 'inbound' | 'media' | 'artifact' | 'notebook';

/** 媒体子类型（store_zone=media 时有效） */
export type MediaType = 'images' | 'audio' | 'video' | 'generated';

/**
 * 入站注册请求
 */
export interface RegisterFileInput {
  /** 原始文件名 */
  originalName: string;
  /** 文件内容 */
  content: Buffer | string;
  /** 来源（FileSource 枚举值或自定义字符串） */
  source: FileSource | string;
  /** 来源 ID（会话ID、任务ID、渠道消息ID等） */
  sourceId?: string;
  /** MIME 类型 */
  mimeType?: string;
  /** 来源描述 */
  description?: string;
  /** 存储分区（默认 inbound） */
  storeZone?: StoreZone;
  /** 分区内子目录（如 notebook 分区下 'exports'，P0-3：导出文件与 NotebookManager 的 .ipynb 隔离） */
  subDir?: string;
  /** 媒体子类型（store_zone=media 时有效） */
  mediaType?: MediaType;
  /** 是否为压缩包 */
  isArchive?: boolean;
  /** 父压缩包 fileId（解压文件时使用） */
  archiveParentId?: string;
  /** 是否跳过 MD5 去重（大文件模式） */
  skipDedup?: boolean;
}

/**
 * 入站注册结果
 */
export interface RegisterFileResult {
  /** 操作类型：created（新建）| duplicate（重复） */
  action: 'created' | 'duplicate';
  /** 文件唯一标识 */
  fileId: string;
  /** 保存完整路径 */
  savedPath: string;
  /** 保存文件名 */
  savedName: string;
  /** 原始文件名 */
  originalName: string;
  /** 文件 MD5 */
  md5: string;
  /** 重复时返回已有记录 */
  existingRecord?: FileRecord;
}

/**
 * 文件记录（对应 file_files 表结构）
 */
export interface FileRecord {
  id: number;
  fileId: string;
  originalName: string;
  savedName: string;
  savedPath: string;
  md5: string;
  size: number;
  mimeType: string;
  source: string;
  sourceId: string;
  storeZone: string;
  mediaType: string;
  category: string;
  description: string;
  isArchive: boolean;
  archiveParentId: string;
  refCount: number;
  isDeleted: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * 文件列表查询参数
 */
export interface FileListQuery {
  /** 来源筛选 */
  source?: string;
  /** 存储分区筛选 */
  storeZone?: string;
  /** 是否为压缩包 */
  isArchive?: boolean;
  /** 起始日期（YYYY-MM-DD） */
  startDate?: string;
  /** 结束日期（YYYY-MM-DD） */
  endDate?: string;
  /** 模糊搜索（匹配 originalName） */
  search?: string;
  /** FTS5 全文搜索关键词 */
  ftsQuery?: string;
  /** 分页偏移 */
  offset?: number;
  /** 每页数量（默认 20） */
  limit?: number;
}

/**
 * 文件列表结果
 */
export interface FileListResult {
  /** 文件列表 */
  files: FileRecord[];
  /** 总数量 */
  total: number;
  /** 统计信息 */
  stats: FileStats;
}

/**
 * 文件统计概览
 */
export interface FileStats {
  /** 文件总数 */
  totalFiles: number;
  /** 总大小（字节） */
  totalSize: number;
  /** 今日入站数 */
  todayCount: number;
  /** 去重节省次数 */
  dedupSaved: number;
  /** 去重节省大小（字节） */
  dedupSavedSize: number;
  /** 压缩包数量 */
  archiveCount: number;
  /** 媒体文件数量 */
  mediaCount: number;
  /** 媒体文件总大小（字节） */
  mediaSize: number;
}

/**
 * DB 行记录（FileRecord 的扁平化版本，从 sqlite3 直接返回）
 */
export interface FileRow {
  id: number;
  file_id: string;
  original_name: string;
  saved_name: string;
  saved_path: string;
  md5: string;
  size: number;
  mime_type: string;
  source: string;
  source_id: string;
  store_zone: string;
  media_type: string;
  category: string;
  description: string;
  is_archive: number;
  archive_parent_id: string;
  ref_count: number;
  is_deleted: number;
  created_at: number;
  updated_at: number;
}

/**
 * 将 DB 行记录转换为 FileRecord
 */
export function rowToFileRecord(row: FileRow): FileRecord {
  return {
    id: row.id,
    fileId: row.file_id,
    originalName: row.original_name,
    savedName: row.saved_name,
    savedPath: row.saved_path,
    md5: row.md5,
    size: row.size,
    mimeType: row.mime_type,
    source: row.source,
    sourceId: row.source_id,
    storeZone: row.store_zone,
    mediaType: row.media_type,
    category: row.category,
    description: row.description,
    isArchive: row.is_archive === 1,
    archiveParentId: row.archive_parent_id,
    refCount: row.ref_count,
    isDeleted: row.is_deleted === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
