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
  };
}
