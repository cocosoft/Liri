/**
 * 记忆访问级别
 */
export type MemoryAccessLevel =
  | 'public'
  | 'team'
  | 'project'
  | 'private'
  | 'protected';

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
    expiresAt: data.expiresAt,
    author: data.author,
    source: data.source,
  };
}
