/**
 * 记忆访问级别
 */
export type MemoryAccessLevel =
  | 'public'
  | 'team'
  | 'project'
  | 'private'
  | 'protected'
  | 'admin';

/** 梦境来源类型 */
export type DreamSourceType =
  | 'conversation'
  | 'knowledge_file'
  | 'user_profile'
  | 'soul'
  | 'manual';

/** 梦境来源追踪：产生此记忆的原始数据源 */
export interface DreamSource {
  /** 来源类型 */
  type: DreamSourceType;
  /** 来源 ID 列表（sessionId / 知识文件路径 / 等） */
  ids: string[];
  /** 梦境周期 ID */
  dreamCycleId: string;
}

/** 当前 schema 版本号 */
export const CURRENT_SCHEMA_VERSION = 2;

/**
 * 记忆元数据
 */
export interface MemoryMetadata {
  /**
   * 记忆名称
   */
  name: string;

  /**
   * 记忆描述
   */
  description: string;

  /**
   * 记忆类型
   */
  type: string;

  /**
   * 记忆创建时间
   */
  createdAt: Date;

  /**
   * 记忆更新时间
   */
  updatedAt: Date;

  /**
   * 记忆标签
   */
  tags?: string[];

  /**
   * 记忆优先级
   */
  priority?: number;

  /**
   * 记忆过期时间
   */
  expiresAt?: Date;

  /**
   * 记忆作者
   */
  author?: string;

  /**
   * 记忆来源
   */
  source?: string;

  /**
   * 记忆重要度（0-1），用于 TTL 差异化
   * 高（>=0.7）：TTL × 2，低（<0.3）：TTL × 0.5，默认 0.5
   */
  importance?: number;

  /**
   * 是否固定
   */
  isPinned?: boolean;

  /**
   * 访问级别
   */
  accessLevel?: MemoryAccessLevel;

  /**
   * 是否加密
   */
  encrypted?: boolean;

  /**
   * 所属会话 ID（任务 4：按 session 分目录）
   * 有值时记忆文件存储在 sessions/{sessionId}/ 目录下
   * 无值时存储在 global/ 目录下
   */
  sessionId?: string;

  /**
   * Schema 版本号，用于未来 schema 演进时的兼容性判断
   * 默认值 1（旧记忆），新记忆使用 CURRENT_SCHEMA_VERSION
   */
  schemaVersion?: number;

  /**
   * 上次梦境处理时间戳（毫秒），null 表示未被梦境处理过
   */
  dreamProcessedAt?: number | null;

  /**
   * 梦境来源追踪：产生此记忆的原始数据源
   */
  dreamSource?: DreamSource;

  /**
   * 是否已被梦境精炼过（与 dreamProcessedAt 配合使用）
   */
  dreamRefined?: boolean;

  /**
   * 软删除标记：被哪条记忆取代（精炼合并时设置）
   */
  deprecatedBy?: string;

  /**
   * 软删除时间戳
   */
  deprecatedAt?: number;

  /**
   * 取代的旧记忆 ID（新记忆设置）
   */
  supersedes?: string;
}

/**
 * 创建记忆元数据
 * @param data 元数据数据
 * @returns 记忆元数据
 */
export function createMemoryMetadata(
  data: Partial<MemoryMetadata>
): MemoryMetadata {
  const now = new Date();
  return {
    name: data.name || 'Untitled Memory',
    description: data.description || '',
    type: data.type || 'user',
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
    tags: data.tags || [],
    priority: data.priority || 0,
    importance: data.importance ?? 0.5,
    expiresAt: data.expiresAt,
    author: data.author,
    source: data.source,
    accessLevel: data.accessLevel,
    encrypted: data.encrypted || false,
    isPinned: data.isPinned || false,
    sessionId: data.sessionId,
    schemaVersion: data.schemaVersion ?? CURRENT_SCHEMA_VERSION,
    dreamProcessedAt: data.dreamProcessedAt ?? null,
    dreamSource: data.dreamSource,
    dreamRefined: data.dreamRefined ?? false,
    deprecatedBy: data.deprecatedBy,
    deprecatedAt: data.deprecatedAt,
    supersedes: data.supersedes,
  };
}
