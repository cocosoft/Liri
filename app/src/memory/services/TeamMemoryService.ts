/**
 * 团队记忆服务
 * 负责团队记忆的同步和管理
 * 支持项目级、团队级和用户级记忆路径
 */

import { Memory } from '../types/Memory';
import { MemoryType } from '../types/MemoryType';

/** MemoryManager 最小接口（避免循环依赖） */
interface MemoryManager {
  getAllMemories(): Promise<Memory[]>;
  updateMemory(id: string, updates: Partial<Memory>): Promise<Memory>;
  createMemory(
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Memory>;
  deleteMemory(id: string): Promise<void>;
  getMemory(id: string): Promise<Memory | null>;
}
import * as fs from 'fs';
import { join } from 'path';
import { resolveDataDir } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import matter from 'gray-matter';

const logger = getLogger('memory:services:teamMemoryService');

/**
 * 记忆路径类型枚举
 */
export enum MemoryPathType {
  /**
   * 公开路径 - 所有人都可以访问
   */
  PUBLIC = 'public',

  /**
   * 项目路径 - 项目成员可以访问
   */
  PROJECT = 'project',

  /**
   * 团队路径 - 团队成员可以访问
   */
  TEAM = 'team',

  /**
   * 用户路径 - 只有用户本人可以访问
   */
  USER = 'user',
}

/**
 * 记忆访问级别枚举
 */
export enum MemoryAccessLevel {
  /**
   * 公开访问
   */
  PUBLIC = 'public',

  /**
   * 团队成员访问
   */
  TEAM = 'team',

  /**
   * 项目成员访问
   */
  PROJECT = 'project',

  /**
   * 私有访问（仅所有者）
   */
  PRIVATE = 'private',

  /**
   * 受保护（管理员）
   */
  PROTECTED = 'protected',
}

/**
 * 团队记忆同步状态
 */
export enum TeamMemorySyncStatus {
  SYNCED = 'synced',
  SYNCING = 'syncing',
  CONFLICT = 'conflict',
  ERROR = 'error',
  NOT_SYNCED = 'not_synced',
}

/**
 * 团队记忆配置
 */
export interface TeamMemoryConfig {
  enabled: boolean;
  teamId: string;
  teamMemoryDir: string;
  syncInterval: number; // 秒
  conflictResolution: 'local_wins' | 'remote_wins' | 'manual';

  /**
   * 是否启用加密存储
   */
  enableEncryption: boolean;

  /**
   * 默认访问级别
   */
  defaultAccessLevel: MemoryAccessLevel;
}

/**
 * 记忆路径配置
 */
export interface MemoryPathConfig {
  type: MemoryPathType;
  path: string;
  accessLevel: MemoryAccessLevel;
  teamId?: string;
  projectId?: string;
  userId?: string;
}

/**
 * 团队记忆统计信息
 */
export interface TeamMemoryStats {
  totalMemories: number;
  publicMemories: number;
  teamMemories: number;
  projectMemories: number;
  privateMemories: number;
  protectedMemories: number;
  lastSyncTime: Date | null;
  syncStatus: TeamMemorySyncStatus;
}

/**
 * 团队记忆冲突
 */
export interface TeamMemoryConflict {
  id: string;
  localMemory: Memory;
  remoteMemory: Memory;
  timestamp: Date;
}

/**
 * 团队记忆同步记录
 */
export interface TeamMemorySyncRecord {
  timestamp: Date;
  status: TeamMemorySyncStatus;
  syncedMemories: number;
  conflicts: TeamMemoryConflict[];
  error?: string;
}

/**
 * 安全集成接口
 */
export interface SecurityIntegration {
  /**
   * 检查用户是否有权限访问记忆
   */
  hasAccess(
    memoryId: string,
    userId?: string,
    accessLevel?: MemoryAccessLevel
  ): boolean;

  /**
   * 检查用户是否有权限创建记忆
   */
  canCreateMemory(userId?: string): boolean;

  /**
   * 检查用户是否有权限删除记忆
   */
  canDeleteMemory(memoryId: string, userId?: string): boolean;

  /**
   * 加密记忆内容
   */
  encrypt(content: string): string;

  /**
   * 解密记忆内容
   */
  decrypt(content: string): string;
}

/**
 * 团队记忆服务
 */
export class TeamMemoryService {
  private memoryManager: MemoryManager;
  private config: TeamMemoryConfig;
  private syncStatus: TeamMemorySyncStatus = TeamMemorySyncStatus.NOT_SYNCED;
  private lastSyncTime: Date | null = null;
  private syncRecords: TeamMemorySyncRecord[] = [];
  private syncIntervalId: NodeJS.Timeout | null = null;
  private securityIntegration: SecurityIntegration | null = null;

  /**
   * 构造函数
   * @param memoryManager 记忆管理器
   * @param config 团队记忆配置
   */
  constructor(
    memoryManager: MemoryManager,
    config: Partial<TeamMemoryConfig> = {}
  ) {
    this.memoryManager = memoryManager;
    this.config = {
      enabled: false,
      teamId: 'default',
      teamMemoryDir: join(resolveDataDir(), 'team-memory'),
      syncInterval: 300, // 5分钟
      conflictResolution: 'local_wins',
      enableEncryption: false,
      defaultAccessLevel: MemoryAccessLevel.TEAM,
      ...config,
    };

    // 确保团队记忆目录存在
    this.ensureTeamMemoryDir();

    // 启动自动同步
    if (this.config.enabled) {
      this.startAutoSync();
    }
  }

  /**
   * 设置安全集成服务
   */
  setSecurityIntegration(security: SecurityIntegration): void {
    this.securityIntegration = security;
  }

  /**
   * 获取安全集成服务
   */
  getSecurityIntegration(): SecurityIntegration | null {
    return this.securityIntegration;
  }

  /**
   * 确保团队记忆目录存在
   */
  private ensureTeamMemoryDir(): void {
    if (!fs.existsSync(this.config.teamMemoryDir)) {
      fs.mkdirSync(this.config.teamMemoryDir, { recursive: true });
    }
  }

  /**
   * 启动自动同步
   */
  private startAutoSync(): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
    }

    this.syncIntervalId = setInterval(async () => {
      await this.sync();
    }, this.config.syncInterval * 1000);
  }

  /**
   * 停止自动同步
   */
  private stopAutoSync(): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  /**
   * 执行同步
   * @returns 同步记录
   */
  async sync(): Promise<TeamMemorySyncRecord> {
    if (!this.config.enabled) {
      const record: TeamMemorySyncRecord = {
        timestamp: new Date(),
        status: TeamMemorySyncStatus.NOT_SYNCED,
        syncedMemories: 0,
        conflicts: [],
        error: 'Team memory is disabled',
      };
      this.syncRecords.push(record);
      return record;
    }

    this.syncStatus = TeamMemorySyncStatus.SYNCING;

    try {
      // 1. 获取本地团队记忆
      const localTeamMemories = await this.getLocalTeamMemories();

      // 2. 读取远程团队记忆（从文件系统）
      const remoteTeamMemories = this.readRemoteTeamMemories();

      // 3. 检测冲突
      const conflicts = this.detectConflicts(
        localTeamMemories,
        remoteTeamMemories
      );

      // 4. 解决冲突
      const resolvedMemories = this.resolveConflicts(conflicts);

      // 5. 合并记忆
      const mergedMemories = this.mergeMemories(
        localTeamMemories,
        remoteTeamMemories,
        resolvedMemories
      );

      // 6. 保存合并后的记忆
      this.saveRemoteTeamMemories(mergedMemories);

      // 7. 更新本地记忆
      await this.updateLocalTeamMemories(mergedMemories);

      const record: TeamMemorySyncRecord = {
        timestamp: new Date(),
        status:
          conflicts.length > 0
            ? TeamMemorySyncStatus.CONFLICT
            : TeamMemorySyncStatus.SYNCED,
        syncedMemories: mergedMemories.length,
        conflicts,
      };

      this.syncRecords.push(record);
      this.lastSyncTime = record.timestamp;
      this.syncStatus = record.status;

      return record;
    } catch (error) {
      const record: TeamMemorySyncRecord = {
        timestamp: new Date(),
        status: TeamMemorySyncStatus.ERROR,
        syncedMemories: 0,
        conflicts: [],
        error: error instanceof Error ? error.message : String(error),
      };

      this.syncRecords.push(record);
      this.syncStatus = TeamMemorySyncStatus.ERROR;

      return record;
    }
  }

  /**
   * 获取本地团队记忆
   * @returns 团队记忆列表
   */
  private async getLocalTeamMemories(): Promise<Memory[]> {
    const allMemories = await this.memoryManager.getAllMemories();
    return allMemories.filter((memory) =>
      memory.metadata.tags?.includes(`team:${this.config.teamId}`)
    );
  }

  /**
   * 读取远程团队记忆
   * @returns 团队记忆列表
   */
  private readRemoteTeamMemories(): Memory[] {
    const memories: Memory[] = [];
    const teamMemDir = this.config.teamMemoryDir;

    if (!fs.existsSync(teamMemDir)) {
      return memories;
    }

    const files = fs.readdirSync(teamMemDir);
    for (const file of files) {
      if (file.endsWith('.md') && file !== 'MEMORY.md') {
        try {
          const filePath = join(teamMemDir, file);
          const content = fs.readFileSync(filePath, 'utf8');
          const { data, content: memoryContent } = matter(content);
          const memory: Memory = {
            id: data.id || file.replace('.md', ''),
            content: memoryContent.trim(),
            metadata: {
              name: data.name || 'Untitled',
              description: data.description || '',
              type: data.type || 'reference',
              createdAt: new Date(data.createdAt || Date.now()),
              updatedAt: new Date(data.updatedAt || Date.now()),
              tags: data.tags || [],
              priority: data.priority || 0,
              expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
              author: data.author,
              source: data.source,
            },
            createdAt: new Date(data.createdAt || Date.now()),
            updatedAt: new Date(data.updatedAt || Date.now()),
          };
          memories.push(memory);
        } catch (error) {
          void handleError(error, {
            module: 'memory:team',
            action: 'read_remote_memory',
            context: { file },
          });
        }
      }
    }

    return memories;
  }

  /**
   * 保存远程团队记忆
   * @param memories 团队记忆列表
   */
  private saveRemoteTeamMemories(memories: Memory[]): void {
    const teamMemDir = this.config.teamMemoryDir;

    // 清空目录
    if (fs.existsSync(teamMemDir)) {
      const files = fs.readdirSync(teamMemDir);
      for (const file of files) {
        if (file.endsWith('.md') && file !== 'MEMORY.md') {
          fs.unlinkSync(join(teamMemDir, file));
        }
      }
    } else {
      fs.mkdirSync(teamMemDir, { recursive: true });
    }

    // 保存记忆
    for (const memory of memories) {
      const filePath = join(teamMemDir, `${memory.id}.md`);
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
      const content = matter.stringify(memory.content, frontmatter);
      fs.writeFileSync(filePath, content, 'utf8');
    }
  }

  /**
   * 更新本地团队记忆
   * @param memories 团队记忆列表
   */
  private async updateLocalTeamMemories(memories: Memory[]): Promise<void> {
    // 获取现有本地团队记忆
    const existingMemories = await this.getLocalTeamMemories();
    const existingMemoryIds = new Set(existingMemories.map((m) => m.id));

    // 新增或更新记忆
    for (const memory of memories) {
      if (existingMemoryIds.has(memory.id)) {
        // 更新现有记忆
        await this.memoryManager.updateMemory(memory.id, memory);
      } else {
        // 创建新记忆
        await this.memoryManager.createMemory({
          content: memory.content,
          metadata: memory.metadata,
        });
      }
    }

    // 删除本地有但远程没有的记忆
    const remoteMemoryIds = new Set(memories.map((m) => m.id));
    for (const memory of existingMemories) {
      if (!remoteMemoryIds.has(memory.id)) {
        await this.memoryManager.deleteMemory(memory.id);
      }
    }
  }

  /**
   * 检测冲突
   * @param localMemories 本地记忆
   * @param remoteMemories 远程记忆
   * @returns 冲突列表
   */
  private detectConflicts(
    localMemories: Memory[],
    remoteMemories: Memory[]
  ): TeamMemoryConflict[] {
    const conflicts: TeamMemoryConflict[] = [];
    const localMemoryMap = new Map(localMemories.map((m) => [m.id, m]));

    for (const remoteMemory of remoteMemories) {
      const localMemory = localMemoryMap.get(remoteMemory.id);
      if (localMemory) {
        // 检查是否有冲突
        if (
          localMemory.updatedAt.getTime() !==
            remoteMemory.updatedAt.getTime() &&
          localMemory.content !== remoteMemory.content
        ) {
          conflicts.push({
            id: remoteMemory.id,
            localMemory,
            remoteMemory,
            timestamp: new Date(),
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * 解决冲突
   * @param conflicts 冲突列表
   * @returns 解决后的记忆列表
   */
  private resolveConflicts(conflicts: TeamMemoryConflict[]): Memory[] {
    const resolvedMemories: Memory[] = [];

    for (const conflict of conflicts) {
      let resolvedMemory: Memory;

      switch (this.config.conflictResolution) {
        case 'local_wins':
          resolvedMemory = conflict.localMemory;
          break;
        case 'remote_wins':
          resolvedMemory = conflict.remoteMemory;
          break;
        case 'manual':
          // 对于手动解决，默认使用本地版本
          resolvedMemory = conflict.localMemory;
          break;
        default:
          resolvedMemory = conflict.localMemory;
      }

      resolvedMemories.push(resolvedMemory);
    }

    return resolvedMemories;
  }

  /**
   * 合并记忆
   * @param localMemories 本地记忆
   * @param remoteMemories 远程记忆
   * @param resolvedMemories 解决后的记忆
   * @returns 合并后的记忆列表
   */
  private mergeMemories(
    localMemories: Memory[],
    remoteMemories: Memory[],
    resolvedMemories: Memory[]
  ): Memory[] {
    const mergedMap = new Map<string, Memory>();

    // 先添加本地记忆
    for (const memory of localMemories) {
      mergedMap.set(memory.id, memory);
    }

    // 再添加远程记忆（会覆盖本地记忆）
    for (const memory of remoteMemories) {
      mergedMap.set(memory.id, memory);
    }

    // 最后添加解决后的记忆（会覆盖冲突的记忆）
    for (const memory of resolvedMemories) {
      mergedMap.set(memory.id, memory);
    }

    return Array.from(mergedMap.values());
  }

  /**
   * 创建团队记忆
   * @param memory 记忆数据
   * @returns 创建的记忆
   */
  async createTeamMemory(
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Memory> {
    // 确保标签包含团队ID
    const tags = [
      ...(memory.metadata.tags || []),
      `team:${this.config.teamId}`,
    ];

    const createdMemory = await this.memoryManager.createMemory({
      ...memory,
      metadata: {
        ...memory.metadata,
        tags,
        type: memory.metadata.type || MemoryType.PROJECT_KNOWLEDGE,
      },
    });

    // 立即同步
    await this.sync();

    return createdMemory;
  }

  /**
   * 获取团队记忆
   * @returns 团队记忆列表
   */
  async getTeamMemories(): Promise<Memory[]> {
    return this.getLocalTeamMemories();
  }

  /**
   * 删除团队记忆
   * @param id 记忆ID
   */
  async deleteTeamMemory(id: string): Promise<void> {
    await this.memoryManager.deleteMemory(id);

    // 立即同步
    await this.sync();
  }

  /**
   * 更新团队记忆
   * @param id 记忆ID
   * @param updates 更新数据
   * @returns 更新后的记忆
   */
  async updateTeamMemory(
    id: string,
    updates: Partial<Memory>
  ): Promise<Memory> {
    const updatedMemory = await this.memoryManager.updateMemory(id, updates);

    // 立即同步
    await this.sync();

    return updatedMemory;
  }

  /**
   * 获取同步状态
   * @returns 同步状态
   */
  getSyncStatus(): TeamMemorySyncStatus {
    return this.syncStatus;
  }

  /**
   * 获取最后同步时间
   * @returns 最后同步时间
   */
  getLastSyncTime(): Date | null {
    return this.lastSyncTime;
  }

  /**
   * 获取同步记录
   * @param limit 限制数量
   * @returns 同步记录列表
   */
  getSyncRecords(limit: number = 10): TeamMemorySyncRecord[] {
    return this.syncRecords.slice(-limit).reverse();
  }

  /**
   * 设置团队记忆配置
   * @param config 配置
   */
  setConfig(config: Partial<TeamMemoryConfig>): void {
    const oldEnabled = this.config.enabled;
    this.config = { ...this.config, ...config };

    // 确保团队记忆目录存在
    this.ensureTeamMemoryDir();

    // 处理自动同步
    if (this.config.enabled && !oldEnabled) {
      this.startAutoSync();
    } else if (!this.config.enabled && oldEnabled) {
      this.stopAutoSync();
    }
  }

  /**
   * 获取团队记忆配置
   * @returns 配置
   */
  getConfig(): TeamMemoryConfig {
    return { ...this.config };
  }

  /**
   * 手动触发同步
   * @returns 同步记录
   */
  async triggerSync(): Promise<TeamMemorySyncRecord> {
    return this.sync();
  }

  /**
   * 获取记忆路径配置
   * @param memoryId 记忆ID
   * @returns 记忆路径配置
   */
  async getMemoryPathConfig(
    memoryId: string
  ): Promise<MemoryPathConfig | null> {
    const memory = await this.memoryManager.getMemory(memoryId);
    if (!memory) {
      return null;
    }

    const tags = memory.metadata.tags || [];
    const accessLevel =
      (memory.metadata.accessLevel as MemoryAccessLevel) ||
      this.config.defaultAccessLevel;

    // 解析路径类型和相关ID
    let pathType = MemoryPathType.TEAM;
    let teamId = this.config.teamId;
    let projectId: string | undefined;
    let userId: string | undefined;

    for (const tag of tags) {
      if (tag.startsWith('path:public')) {
        pathType = MemoryPathType.PUBLIC;
      } else if (tag.startsWith('path:project:')) {
        pathType = MemoryPathType.PROJECT;
        projectId = tag.substring(13);
      } else if (tag.startsWith('path:team:')) {
        pathType = MemoryPathType.TEAM;
        teamId = tag.substring(10);
      } else if (tag.startsWith('path:user:')) {
        pathType = MemoryPathType.USER;
        userId = tag.substring(10);
      } else if (tag.startsWith('project:')) {
        projectId = tag.substring(9);
      } else if (tag.startsWith('user:')) {
        userId = tag.substring(5);
      }
    }

    return {
      type: pathType,
      path: this.getPathString(pathType, teamId, projectId, userId),
      accessLevel,
      teamId,
      projectId,
      userId,
    };
  }

  /**
   * 获取路径字符串
   */
  private getPathString(
    type: MemoryPathType,
    teamId?: string,
    projectId?: string,
    userId?: string
  ): string {
    switch (type) {
      case MemoryPathType.PUBLIC:
        return '/public';
      case MemoryPathType.PROJECT:
        return `/teams/${teamId}/projects/${projectId}`;
      case MemoryPathType.TEAM:
        return `/teams/${teamId}`;
      case MemoryPathType.USER:
        return `/users/${userId}`;
      default:
        return '/unknown';
    }
  }

  /**
   * 根据路径类型获取记忆
   * @param pathType 路径类型
   * @param teamId 团队ID（可选）
   * @param projectId 项目ID（可选）
   * @param userId 用户ID（可选）
   * @returns 记忆列表
   */
  async getMemoriesByPath(
    pathType: MemoryPathType,
    teamId?: string,
    projectId?: string,
    userId?: string
  ): Promise<Memory[]> {
    const allMemories = await this.memoryManager.getAllMemories();

    return allMemories.filter((memory) => {
      const tags = memory.metadata.tags || [];
      const accessLevel = memory.metadata.accessLevel as MemoryAccessLevel;

      // 根据路径类型过滤
      switch (pathType) {
        case MemoryPathType.PUBLIC:
          return (
            accessLevel === MemoryAccessLevel.PUBLIC ||
            tags.includes('path:public')
          );
        case MemoryPathType.PROJECT:
          return (
            tags.some(
              (tag) =>
                tag.startsWith('path:project:') &&
                (projectId ? tag === `path:project:${projectId}` : true)
            ) || accessLevel === MemoryAccessLevel.PROJECT
          );
        case MemoryPathType.TEAM:
          const teamTag = teamId
            ? `path:team:${teamId}`
            : `path:team:${this.config.teamId}`;
          return (
            tags.includes(teamTag) ||
            tags.includes(`team:${teamId || this.config.teamId}`) ||
            accessLevel === MemoryAccessLevel.TEAM
          );
        case MemoryPathType.USER:
          return (
            tags.some(
              (tag) =>
                tag.startsWith('path:user:') &&
                (userId ? tag === `path:user:${userId}` : true)
            ) || accessLevel === MemoryAccessLevel.PRIVATE
          );
        default:
          return true;
      }
    });
  }

  /**
   * 创建带路径的团队记忆
   * @param memory 记忆数据
   * @param pathConfig 路径配置
   * @param userId 用户ID（可选）
   * @returns 创建的记忆
   */
  async createMemoryWithPath(
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>,
    pathConfig: MemoryPathConfig,
    userId?: string
  ): Promise<Memory> {
    // 检查权限
    if (this.securityIntegration) {
      if (!this.securityIntegration.canCreateMemory(userId)) {
        throw new AppError(
          'Permission denied: Cannot create memory',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }
    }

    // 构建标签
    const tags = [...(memory.metadata.tags || [])];

    // 添加路径标签
    switch (pathConfig.type) {
      case MemoryPathType.PUBLIC:
        tags.push('path:public');
        break;
      case MemoryPathType.PROJECT:
        tags.push(`path:project:${pathConfig.projectId || ''}`);
        tags.push(`project:${pathConfig.projectId || ''}`);
        break;
      case MemoryPathType.TEAM:
        tags.push(`path:team:${pathConfig.teamId || this.config.teamId}`);
        tags.push(`team:${pathConfig.teamId || this.config.teamId}`);
        break;
      case MemoryPathType.USER:
        tags.push(`path:user:${pathConfig.userId || userId || ''}`);
        tags.push(`user:${pathConfig.userId || userId || ''}`);
        break;
    }

    // 设置访问级别
    const accessLevel = pathConfig.accessLevel;

    // 如果启用加密，加密内容
    let content = memory.content;
    if (
      this.config.enableEncryption &&
      this.securityIntegration &&
      (accessLevel === MemoryAccessLevel.PRIVATE ||
        accessLevel === MemoryAccessLevel.PROTECTED)
    ) {
      content = this.securityIntegration.encrypt(content);
    }

    const createdMemory = await this.memoryManager.createMemory({
      ...memory,
      content,
      metadata: {
        ...memory.metadata,
        tags,
        accessLevel,
        type: memory.metadata.type || MemoryType.PROJECT_KNOWLEDGE,
        encrypted:
          this.config.enableEncryption &&
          (accessLevel === MemoryAccessLevel.PRIVATE ||
            accessLevel === MemoryAccessLevel.PROTECTED),
      },
    });

    // 立即同步
    await this.sync();

    return createdMemory;
  }

  /**
   * 检查用户是否有权限访问记忆
   * @param memoryId 记忆ID
   * @param userId 用户ID（可选）
   * @returns 是否有权限
   */
  async hasAccess(memoryId: string, userId?: string): Promise<boolean> {
    // 如果有安全集成，使用安全集成检查
    if (this.securityIntegration) {
      return this.securityIntegration.hasAccess(memoryId, userId);
    }

    // 默认检查：公开和团队记忆所有人都可以访问
    const memory = await this.memoryManager.getMemory(memoryId);
    if (!memory) {
      return false;
    }

    const accessLevel = memory.metadata.accessLevel as MemoryAccessLevel;
    const tags = memory.metadata.tags || [];

    // 公开记忆所有人都可以访问
    if (
      accessLevel === MemoryAccessLevel.PUBLIC ||
      tags.includes('path:public')
    ) {
      return true;
    }

    // 团队记忆检查
    if (
      accessLevel === MemoryAccessLevel.TEAM ||
      tags.some((tag) => tag.startsWith('team:'))
    ) {
      return true; // 假设已认证用户都是团队成员
    }

    // 私有记忆只有所有者可以访问
    if (accessLevel === MemoryAccessLevel.PRIVATE) {
      // 检查用户标签
      return tags.some((tag) => tag === `user:${userId}`);
    }

    return false;
  }

  /**
   * 获取团队记忆统计信息
   * @returns 统计信息
   */
  async getStats(): Promise<TeamMemoryStats> {
    const allMemories = await this.getAllMemories();

    let publicMemories = 0;
    let teamMemories = 0;
    let projectMemories = 0;
    let privateMemories = 0;
    let protectedMemories = 0;

    for (const memory of allMemories) {
      const accessLevel = memory.metadata.accessLevel as MemoryAccessLevel;

      switch (accessLevel) {
        case MemoryAccessLevel.PUBLIC:
          publicMemories++;
          break;
        case MemoryAccessLevel.TEAM:
          teamMemories++;
          break;
        case MemoryAccessLevel.PROJECT:
          projectMemories++;
          break;
        case MemoryAccessLevel.PRIVATE:
          privateMemories++;
          break;
        case MemoryAccessLevel.PROTECTED:
          protectedMemories++;
          break;
        default:
          teamMemories++; // 默认归为团队记忆
      }
    }

    return {
      totalMemories: allMemories.length,
      publicMemories,
      teamMemories,
      projectMemories,
      privateMemories,
      protectedMemories,
      lastSyncTime: this.lastSyncTime,
      syncStatus: this.syncStatus,
    };
  }

  /**
   * 获取所有记忆（包括解密）
   */
  async getAllMemories(): Promise<Memory[]> {
    const memories = await this.memoryManager.getAllMemories();

    // 如果有安全集成且启用加密，解密受保护的记忆
    if (this.securityIntegration && this.config.enableEncryption) {
      return memories.map((memory) => {
        if (memory.metadata.encrypted) {
          try {
            return {
              ...memory,
              content: this.securityIntegration!.decrypt(memory.content),
            };
          } catch {
            return memory;
          }
        }
        return memory;
      });
    }

    return memories;
  }

  /**
   * 清理团队记忆目录
   */
  cleanupTeamMemoryDir(): void {
    if (fs.existsSync(this.config.teamMemoryDir)) {
      fs.rmSync(this.config.teamMemoryDir, { recursive: true, force: true });
      this.ensureTeamMemoryDir();
    }
  }

  /**
   * 销毁服务
   */
  destroy(): void {
    this.stopAutoSync();
  }
}

/**
 * 创建团队记忆服务实例
 * @param memoryManager 记忆管理器
 * @param config 团队记忆配置
 * @returns 团队记忆服务实例
 */
export function createTeamMemoryService(
  memoryManager: MemoryManager,
  config: Partial<TeamMemoryConfig> = {}
): TeamMemoryService {
  return new TeamMemoryService(memoryManager, config);
}
